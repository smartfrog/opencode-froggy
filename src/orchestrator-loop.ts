import { randomUUID } from "node:crypto"
import { type Plugin } from "@opencode/plugin"
import { asRecord } from "./record"
import { log } from "./logger"

export const DEFAULT_LOOP_INTERVAL_MINUTES = 10
export const MAX_LOOP_INTERVAL_MINUTES = Math.floor(2_147_483_647 / 60_000)
const STORAGE_PREFIX = "orchestrator-loop/"
const REMINDER_SOURCE = "opencode-froggy:orchestrator-loop"
const COORDINATION_KEY = Symbol.for("opencode-froggy:orchestrator-loop:coordination:v2")
const SHARED = globalThis as typeof globalThis & {
  [COORDINATION_KEY]?: {
    operations: Map<string, Promise<void>>
    reminders: Map<string, ReminderAttempt>
  }
}
// Share in-flight coordination across location-specific plugin copies and reloads.
const { operations: SESSION_OPERATIONS, reminders: IN_FLIGHT_REMINDERS } = SHARED[COORDINATION_KEY] ??= {
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

export function createOrchestratorLoop(options: {
  directory: string
  storage: LoopStorage
  session: LoopSessionClient
  activity: (sessionID: string) => Promise<string>
}) {
  const { directory, storage, session, activity } = options
  const runtimes = new Map<string, Runtime>()
  const operations = new Set<Promise<void>>()
  let closed = false

  const key = (sessionID: string) => `${STORAGE_PREFIX}${sessionID}`
  const current = (runtime: Runtime) => !closed && runtimes.get(runtime.config.sessionID) === runtime

  function ensureOpen(): void {
    if (closed) throw new Error("Orchestrator loop manager is closed")
  }

  function exclusive<T>(sessionID: string, operation: () => Promise<T>): Promise<T> {
    const result = (SESSION_OPERATIONS.get(sessionID) ?? Promise.resolve()).then(operation)
    // The caller observes failures; the serialization gate must still release.
    const gate = result.then(() => {}, () => {})
    SESSION_OPERATIONS.set(sessionID, gate)
    operations.add(gate)
    void gate.then(() => {
      operations.delete(gate)
      if (SESSION_OPERATIONS.get(sessionID) === gate) SESSION_OPERATIONS.delete(sessionID)
    })
    return result
  }

  function forget(runtime: Runtime): void {
    clearTimeout(runtime.timer)
    if (runtimes.get(runtime.config.sessionID) === runtime) runtimes.delete(runtime.config.sessionID)
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
    runtime.timer = setTimeout(() => {
      const { sessionID } = runtime.config
      const pending = IN_FLIGHT_REMINDERS.get(sessionID)
      const running: Promise<void> = (pending?.running ?? tick(runtime))
        .catch(async (error: unknown) => {
          if (isMissingSession(error)) {
            try {
              await storage.remove(key(runtime.config.sessionID))
              forget(runtime)
              return
            } catch (cleanupError) {
              error = cleanupError
            }
          }
          log("[orchestrator-loop] reminder failed; retrying next interval", {
            sessionID: runtime.config.sessionID,
            error: String(error),
          })
        })
        .finally(() => {
          operations.delete(running)
          if (!pending) IN_FLIGHT_REMINDERS.delete(sessionID)
          schedule(runtime)
        })
      operations.add(running)
      if (!pending) IN_FLIGHT_REMINDERS.set(sessionID, { running, cancel: () => forget(runtime) })
    }, delay)
    runtime.timer.unref()
  }

  async function tick(runtime: Runtime): Promise<void> {
    const { sessionID, objective, revision } = runtime.config
    const input = {
      sessionID,
      description: "Orchestrator coordination reminder",
      delivery: "steer" as const,
      metadata: { source: REMINDER_SOURCE, revision },
    }
    if (!await canRemind(runtime)) return
    const pending = await pendingReminders(sessionID)
    if (!await stillCurrent(runtime)) return
    const existing = pending.find((item) => asRecord(asRecord(item.payload).metadata).revision === revision)
    for (const item of pending) {
      if (item !== existing) await session.inbox.cancel({ sessionID, inboxID: item.id })
    }
    if (existing) {
      if (!await canRemind(runtime) || !current(runtime)) return
      const text = asRecord(existing.payload).text
      if (typeof text !== "string") throw new Error("Invalid pending orchestrator reminder text")
      await session.synthetic({ ...input, id: existing.id, text, resume: true })
      return
    }
    let snapshot: string
    try {
      snapshot = await activity(sessionID)
    } catch (error) {
      snapshot = `Activity snapshot unavailable: ${String(error)}. Verify child activity before assigning work.`
    }
    if (!await canRemind(runtime) || !current(runtime)) return
    const text = [
      "Periodic orchestration check.",
      `Objective: ${objective}`,
      "",
      snapshot,
      "",
      "Review child results, outstanding tasks, and blockers against the objective.",
      "An inactive child may still await a shell or another background tool. Verify before relaunching it.",
      "Use subagent with the recorded sessionID and agent for same-subject follow-ups, with background: true.",
      "Create a new child session for a new subject. When nothing is progressing, choose useful next work within the objective.",
      "Call stop-orchestrator-loop when the objective is achieved or the user asks to stop these reminders.",
    ].join("\n")
    const reminder = await session.synthetic({ ...input, text, resume: false })
    if (!await canRemind(runtime) || !current(runtime)) {
      await session.inbox.cancel({ sessionID, inboxID: reminder.id })
      return
    }
    // Re-admitting the same ID wakes execution without duplicating the durable input.
    await session.synthetic({ ...input, id: reminder.id, text, resume: true })
  }

  return {
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
            const runtime: Runtime = { config }
            runtimes.set(config.sessionID, runtime)
            schedule(runtime)
          })
        }
        if (page.next !== undefined && page.next === after) throw new Error("Loop storage pagination did not advance")
        after = page.next
      } while (after !== undefined && !closed)
    },
    async start(sessionID: string, input: unknown) {
      ensureOpen()
      if (typeof sessionID !== "string" || !sessionID.startsWith("ses")) throw new Error("A session ID is required")
      const settings = readSettings(input)
      return exclusive(sessionID, async () => {
        ensureOpen()
        const info = asRecord(await session.get({ sessionID }))
        if (info.agent !== "orchestrator" || info.parentID) {
          throw new Error("Start the loop from a root orchestrator session")
        }
        await retire(sessionID)
        ensureOpen()
        const config: LoopConfig = {
          version: 1, sessionID, directory, ...settings,
          startedAt: Date.now(), revision: randomUUID(),
        }
        await storage.set(key(sessionID), config)
        ensureOpen()
        const runtime: Runtime = { config }
        runtimes.set(sessionID, runtime)
        schedule(runtime)
        return { intervalMinutes: config.intervalMinutes }
      })
    },
    async stop(sessionID: string): Promise<void> {
      ensureOpen()
      if (typeof sessionID !== "string" || !sessionID.startsWith("ses")) throw new Error("A session ID is required")
      await exclusive(sessionID, () => retire(sessionID))
    },
    async close(): Promise<void> {
      closed = true
      for (const runtime of runtimes.values()) clearTimeout(runtime.timer)
      await Promise.all(operations)
      runtimes.clear()
    },
  }
}
