import { randomUUID } from "node:crypto"
import { type Plugin } from "@opencode/plugin"
import { asRecord } from "./record"
import { log } from "./logger"
import { mergeLoopDiagnostics, readLoopDiagnostics, type LoopDiagnostics } from "./orchestrator-diagnostics"

export const DEFAULT_LOOP_INTERVAL_MINUTES = 10
export const MAX_LOOP_INTERVAL_MINUTES = Math.floor(2_147_483_647 / 60_000)
const STORAGE_PREFIX = "orchestrator-loop/"
const DIAGNOSTICS_PREFIX = "orchestrator-diagnostics/"
const REMINDER_SOURCE = "opencode-froggy:orchestrator-loop"
const REMINDER_TEXT = [
  "Periodic coordination check:",
  "- Check current worker/background activity, new results, pending reviews, and blockers.",
  "- Reconcile meaningful changes with the reference backlog and verify updates were saved.",
  "- Reconcile temporary workspaces and release eligible ones following the workspace lifecycle.",
  "- Unblock stalled work or advance the next useful action toward the objective.",
].join("\n")
const COORDINATION_KEY = Symbol.for("opencode-froggy:orchestrator-loop:coordination:v2")
const SHARED = globalThis as typeof globalThis & {
  [COORDINATION_KEY]?: {
    operations: Map<string, Promise<void>>
    reminders: Map<string, ReminderAttempt>
  }
}
// Share in-flight coordination across location-specific plugin copies and reloads.
const { operations: COORDINATION_OPERATIONS, reminders: IN_FLIGHT_REMINDERS } = SHARED[COORDINATION_KEY] ??= {
  operations: new Map<string, Promise<void>>(),
  reminders: new Map<string, ReminderAttempt>(),
}

export type LoopStorage = Plugin.Context["storage"]

export interface LoopSessionClient {
  get(input: { sessionID: string }): Promise<unknown>
  synthetic(input: {
    sessionID: string
    id?: string
    text: string
    description: string
    metadata: Record<string, string>
    delivery: "steer"
    resume: boolean
  }): Promise<{ id: string }>
  inbox: {
    list(input: { sessionID: string }): Promise<{ id: string; type: string; payload: unknown }[]>
    cancel(input: { sessionID: string; inboxID: string }): Promise<void>
  }
}

type LoopConfig = {
  version: 1
  sessionID: string
  directory: string
  objective: string
  intervalMinutes: number
  startedAt: number
  revision: string
}

interface Runtime {
  config: LoopConfig
  timer?: ReturnType<typeof setTimeout>
  nextCheckAt?: number
  diagnostics?: LoopDiagnostics
  flushingDiagnostics?: boolean
  persistenceError?: string
}

interface ReminderAttempt {
  running: Promise<void>
  cancel: () => void
}

function readSettings(input: unknown): { objective: string; intervalMinutes: number } {
  const args = asRecord(input)
  if (typeof args.objective !== "string" || !args.objective.trim()) {
    throw new Error("A non-empty objective is required")
  }
  const intervalMinutes = args.intervalMinutes === undefined ? DEFAULT_LOOP_INTERVAL_MINUTES : args.intervalMinutes
  if (typeof intervalMinutes !== "number" || !Number.isSafeInteger(intervalMinutes) ||
      intervalMinutes < 1 || intervalMinutes > MAX_LOOP_INTERVAL_MINUTES) {
    throw new Error(`intervalMinutes must be an integer between 1 and ${MAX_LOOP_INTERVAL_MINUTES}`)
  }
  return { objective: args.objective.trim(), intervalMinutes }
}

function readConfig(value: unknown): LoopConfig {
  const record = asRecord(value)
  const settings = readSettings(record)
  if (record.version !== 1 || typeof record.sessionID !== "string" || !record.sessionID.startsWith("ses") ||
      typeof record.directory !== "string" || !record.directory ||
      typeof record.revision !== "string" || !record.revision ||
      typeof record.startedAt !== "number" || !Number.isSafeInteger(record.startedAt) || record.startedAt < 0) {
    throw new Error("Invalid stored orchestrator loop")
  }
  return {
    version: 1,
    sessionID: record.sessionID,
    directory: record.directory,
    revision: record.revision,
    startedAt: record.startedAt,
    ...settings,
  }
}

function isMissingSession(error: unknown): boolean {
  const tag = asRecord(error)._tag
  return tag === "SessionNotFoundError" || tag === "Session.NotFoundError"
}

function validateSessionID(sessionID: unknown): void {
  if (typeof sessionID !== "string" || !sessionID.startsWith("ses")) throw new Error("A session ID is required")
}

export function createOrchestratorLoop(options: {
  directory: string
  storage: LoopStorage
  session: LoopSessionClient
}) {
  const { directory, storage, session } = options
  const runtimes = new Map<string, Runtime>()
  const operations = new Set<Promise<void>>()
  let closed = false

  const key = (sessionID: string) => `${STORAGE_PREFIX}${sessionID}`
  const diagnosticsKey = (sessionID: string) => `${DIAGNOSTICS_PREFIX}${sessionID}`
  const current = (runtime: Runtime) => !closed && runtimes.get(runtime.config.sessionID) === runtime

  function ensureOpen(): void {
    if (closed) throw new Error("Orchestrator loop manager is closed")
  }

  function exclusive<T>(operationKey: string, operation: () => Promise<T>): Promise<T> {
    const result = (COORDINATION_OPERATIONS.get(operationKey) ?? Promise.resolve()).then(operation)
    // The caller observes failures; the serialization gate must still release.
    const gate = result.then(() => {}, () => {})
    COORDINATION_OPERATIONS.set(operationKey, gate)
    operations.add(gate)
    void gate.then(() => {
      operations.delete(gate)
      if (COORDINATION_OPERATIONS.get(operationKey) === gate) COORDINATION_OPERATIONS.delete(operationKey)
    })
    return result
  }

  function forget(runtime: Runtime): void {
    clearTimeout(runtime.timer)
    if (runtimes.get(runtime.config.sessionID) === runtime) runtimes.delete(runtime.config.sessionID)
  }

  function activate(config: LoopConfig): Runtime {
    const runtime: Runtime = { config }
    runtimes.set(config.sessionID, runtime)
    schedule(runtime)
    return runtime
  }

  async function stillCurrent(runtime: Runtime): Promise<boolean> {
    if (!current(runtime)) return false
    const stored = asRecord(await storage.get(key(runtime.config.sessionID)))
    if (!current(runtime)) return false
    if (stored.revision !== runtime.config.revision) {
      forget(runtime)
      return false
    }
    return true
  }

  async function pendingReminders(sessionID: string) {
    return (await session.inbox.list({ sessionID })).filter((item) =>
      item.type === "synthetic" && asRecord(asRecord(item.payload).metadata).source === REMINDER_SOURCE,
    )
  }

  async function canRemind(runtime: Runtime): Promise<boolean> {
    if (!await stillCurrent(runtime)) return false
    const info = asRecord(await session.get({ sessionID: runtime.config.sessionID }))
    return current(runtime) && info.agent === "orchestrator" && !info.parentID
  }

  function saveDiagnostics(runtime: Runtime, snapshot: LoopDiagnostics): Promise<void> {
    const { sessionID, revision } = runtime.config
    return exclusive(diagnosticsKey(sessionID), async () => {
      if (asRecord(await storage.get(key(sessionID))).revision !== revision) return
      const value = await storage.get(diagnosticsKey(sessionID))
      const saved = asRecord(value).revision === revision ? readLoopDiagnostics(value) : undefined
      await storage.set(diagnosticsKey(sessionID), {
        ...mergeLoopDiagnostics(saved ?? {}, snapshot),
        version: 1,
        revision,
      })
    })
  }

  function recordDiagnosticsFailure(runtime: Runtime, error: unknown): void {
    runtime.persistenceError = String(error)
    log("[orchestrator-loop] diagnostics persistence failed", { sessionID: runtime.config.sessionID, error: String(error) })
  }

  function flushDiagnostics(runtime: Runtime): void {
    const snapshot = runtime.diagnostics
    if (!snapshot || runtime.flushingDiagnostics) return
    let saved = false
    const flushing = saveDiagnostics(runtime, snapshot)
      .then(() => {
        saved = true
        if (runtime.diagnostics === snapshot) runtime.diagnostics = undefined
        runtime.persistenceError = undefined
      })
      .catch((error: unknown) => recordDiagnosticsFailure(runtime, error))
      .finally(() => {
        runtime.flushingDiagnostics = undefined
        operations.delete(flushing)
        if (saved && runtime.diagnostics) flushDiagnostics(runtime)
      })
    runtime.flushingDiagnostics = true
    operations.add(flushing)
  }

  function clearDiagnostics(sessionID: string): Promise<void> {
    return exclusive(diagnosticsKey(sessionID), () => storage.remove(diagnosticsKey(sessionID)))
  }

  function queueDiagnosticsCleanup(runtime: Runtime): void {
    const cleanup = clearDiagnostics(runtime.config.sessionID)
      .catch((error: unknown) => recordDiagnosticsFailure(runtime, error))
      .finally(() => operations.delete(cleanup))
    operations.add(cleanup)
  }

  async function retire(sessionID: string): Promise<void> {
    const runtime = runtimes.get(sessionID)
    if (runtime) forget(runtime)
    IN_FLIGHT_REMINDERS.get(sessionID)?.cancel()
    await storage.remove(key(sessionID))
    // Catch attempts that started while durable removal was pending.
    const pending = IN_FLIGHT_REMINDERS.get(sessionID)
    pending?.cancel()
    await pending?.running
    try {
      for (const item of await pendingReminders(sessionID)) {
        await session.inbox.cancel({ sessionID, inboxID: item.id })
      }
    } catch (error) {
      if (!isMissingSession(error)) throw error
    }
  }

  function schedule(runtime: Runtime): void {
    if (!current(runtime)) return
    const interval = runtime.config.intervalMinutes * 60_000
    const elapsed = Math.max(0, Date.now() - runtime.config.startedAt)
    const delay = interval - elapsed % interval
    runtime.nextCheckAt = Date.now() + delay
    runtime.timer = setTimeout(() => {
      runtime.nextCheckAt = undefined
      const { sessionID } = runtime.config
      const pending = IN_FLIGHT_REMINDERS.get(sessionID)
      const running: Promise<void> = (pending?.running ?? tick(runtime))
        .catch(async (error: unknown) => {
          if (isMissingSession(error)) {
            try {
              await storage.remove(key(runtime.config.sessionID))
              forget(runtime)
              queueDiagnosticsCleanup(runtime)
              return
            } catch (cleanupError) {
              error = cleanupError
            }
          }
          log("[orchestrator-loop] reminder failed; retrying next interval", {
            sessionID: runtime.config.sessionID,
            error: String(error),
          })
          runtime.diagnostics = { ...runtime.diagnostics, lastError: { at: Date.now(), message: String(error) } }
        })
        .finally(() => {
          operations.delete(running)
          if (!pending) IN_FLIGHT_REMINDERS.delete(sessionID)
          schedule(runtime)
          if (!pending) flushDiagnostics(runtime)
        })
      operations.add(running)
      if (!pending) IN_FLIGHT_REMINDERS.set(sessionID, { running, cancel: () => forget(runtime) })
    }, delay)
    runtime.timer.unref()
  }

  async function tick(runtime: Runtime): Promise<void> {
    const { sessionID, revision } = runtime.config
    const input = {
      sessionID,
      text: REMINDER_TEXT,
      description: "Orchestrator coordination reminder",
      delivery: "steer" as const,
      metadata: { source: REMINDER_SOURCE, revision },
    }
    if (!await canRemind(runtime)) return
    const pending = await pendingReminders(sessionID)
    if (!await stillCurrent(runtime)) return
    const existing = pending.find((item) => {
      const payload = asRecord(item.payload)
      return asRecord(payload.metadata).revision === revision && payload.text === REMINDER_TEXT
    })
    for (const item of pending) {
      if (item !== existing) await session.inbox.cancel({ sessionID, inboxID: item.id })
    }
    if (!await canRemind(runtime) || !current(runtime)) return
    const reminder = existing ?? await session.synthetic({ ...input, resume: false })
    if (!existing) {
      runtime.diagnostics = { ...runtime.diagnostics, lastReminderAdmitted: { at: Date.now(), inboxID: reminder.id } }
      if (!await canRemind(runtime) || !current(runtime)) {
        await session.inbox.cancel({ sessionID, inboxID: reminder.id })
        return
      }
    }
    // Re-admitting the same ID wakes execution without duplicating the durable input.
    await session.synthetic({ ...input, id: reminder.id, resume: true })
    runtime.diagnostics = { ...runtime.diagnostics, lastWakeRequested: { at: Date.now(), inboxID: reminder.id } }
  }

  return {
    async status(sessionID: string) {
      ensureOpen()
      validateSessionID(sessionID)
      return exclusive(sessionID, async () => {
        ensureOpen()
        const stored = await storage.get(key(sessionID))
        const config = stored === undefined ? undefined : readConfig(stored)
        if (config && config.sessionID !== sessionID) throw new Error("Loop storage key does not match its session")
        const candidate = runtimes.get(sessionID)
        const runtime = candidate && config?.revision === candidate.config.revision && current(candidate) ? candidate : undefined
        let info: Record<string, unknown> = {}
        let sessionError: string | null = null
        try {
          info = asRecord(await session.get({ sessionID }))
        } catch (error) {
          sessionError = String(error)
        }
        const selectedAgent = typeof info.agent === "string" ? info.agent : null
        let suspensionReason: string | null = null
        if (config && !sessionError) {
          if (info.parentID) suspensionReason = "child-session"
          else if (selectedAgent !== "orchestrator") suspensionReason = "different-agent"
        }
        let pending: { state: "verified"; ids: string[] } | { state: "unavailable"; error: string }
        try {
          pending = { state: "verified", ids: (await pendingReminders(sessionID)).map((item) => item.id) }
        } catch (error) {
          pending = { state: "unavailable", error: String(error) }
        }
        let diagnostics: LoopDiagnostics = {}
        let readError: string | null = null
        try {
          const saved = readLoopDiagnostics(await storage.get(diagnosticsKey(sessionID)))
          if (config && saved?.revision === config.revision) diagnostics = saved
        } catch (error) {
          readError = String(error)
        }
        diagnostics = mergeLoopDiagnostics(diagnostics, runtime?.diagnostics ?? {})
        let state = "disabled"
        if (config) {
          if (sessionError) state = "unknown"
          else if (suspensionReason) state = "paused"
          else state = runtime ? "scheduled" : "not-loaded-here"
        }
        return {
          sessionID,
          observedAt: Date.now(),
          enabled: config !== undefined,
          state,
          objective: config?.objective ?? null,
          intervalMinutes: config?.intervalMinutes ?? null,
          ownerDirectory: config?.directory ?? null,
          selectedAgent,
          suspensionReason,
          sessionError,
          scheduler: { loadedHere: runtime !== undefined, nextCheckAt: runtime?.nextCheckAt ?? null },
          pending,
          diagnostics: {
            lastReminderAdmitted: diagnostics.lastReminderAdmitted ?? null,
            lastWakeRequested: diagnostics.lastWakeRequested ?? null,
            lastError: diagnostics.lastError ?? null,
            persistenceError: runtime?.persistenceError ?? null,
            persistencePending: COORDINATION_OPERATIONS.has(diagnosticsKey(sessionID)),
            readError,
          },
        }
      })
    },
    async restore(): Promise<void> {
      ensureOpen()
      let after: string | undefined
      do {
        const page = await storage.scan({ prefix: STORAGE_PREFIX, after, limit: 100 })
        for (const entry of page.entries) {
          await exclusive(entry.key.slice(STORAGE_PREFIX.length), async () => {
            if (closed) return
            const value = await storage.get(entry.key)
            if (value === undefined) return
            let config: LoopConfig
            try {
              config = readConfig(value)
              if (key(config.sessionID) !== entry.key) throw new Error("Loop storage key does not match its session")
            } catch (error) {
              log("[orchestrator-loop] invalid stored loop; start it again to replace it", { key: entry.key, error: String(error) })
              return
            }
            if (closed || config.directory !== directory || runtimes.has(config.sessionID)) return
            activate(config)
          })
        }
        if (page.next !== undefined && page.next === after) throw new Error("Loop storage pagination did not advance")
        after = page.next
      } while (after !== undefined && !closed)
    },
    async start(sessionID: string, input: unknown) {
      ensureOpen()
      validateSessionID(sessionID)
      const settings = readSettings(input)
      return exclusive(sessionID, async () => {
        ensureOpen()
        const info = asRecord(await session.get({ sessionID }))
        if (info.agent !== "orchestrator" || info.parentID) {
          throw new Error("Start the loop from a root orchestrator session")
        }
        const stored = await storage.get(key(sessionID))
        ensureOpen()
        let existing: LoopConfig | undefined
        if (stored !== undefined) {
          try {
            existing = readConfig(stored)
          } catch (error) {
            log("[orchestrator-loop] replacing invalid stored loop", { sessionID, error: String(error) })
          }
        }
        if (existing?.sessionID === sessionID && existing.directory === directory &&
            existing.objective === settings.objective && existing.intervalMinutes === settings.intervalMinutes) {
          const runtime = runtimes.get(sessionID)
          if (runtime?.config.revision !== existing.revision) {
            if (runtime) forget(runtime)
            activate(existing)
          }
          return { intervalMinutes: existing.intervalMinutes, changed: false }
        }
        await retire(sessionID)
        ensureOpen()
        const config: LoopConfig = {
          version: 1, sessionID, directory, ...settings,
          startedAt: Date.now(), revision: randomUUID(),
        }
        await storage.set(key(sessionID), config)
        ensureOpen()
        queueDiagnosticsCleanup(activate(config))
        return { intervalMinutes: config.intervalMinutes, changed: true }
      })
    },
    async stop(sessionID: string): Promise<void> {
      ensureOpen()
      validateSessionID(sessionID)
      await exclusive(sessionID, async () => {
        const errors: unknown[] = []
        try {
          await retire(sessionID)
        } catch (error) {
          errors.push(error)
        }
        try {
          await clearDiagnostics(sessionID)
        } catch (error) {
          errors.push(error)
        }
        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, "Orchestrator loop cleanup incomplete", { cause: errors[0] })
      })
    },
    async close(): Promise<void> {
      closed = true
      for (const runtime of runtimes.values()) {
        clearTimeout(runtime.timer)
        flushDiagnostics(runtime)
      }
      while (operations.size) await Promise.all([...operations])
      runtimes.clear()
    },
  }
}
