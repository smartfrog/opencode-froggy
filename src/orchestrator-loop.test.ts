import { afterEach, beforeEach, describe, expect, it, jest, type Mock } from "bun:test"
import { createOrchestratorLoop, type LoopSessionClient, type LoopStorage } from "./orchestrator-loop"
import { createOrchestratorLoopTools } from "./tools/orchestrator-loop"

const MINUTE = 60_000
const loops: ReturnType<typeof createOrchestratorLoop>[] = []

const mocked = <T extends (...args: any[]) => any>(fn: T) => fn as unknown as Mock<T>

let scheduled = new Map<number, number>()
let restoreTimers: (() => void) | undefined

function trackTimers() {
  const set = globalThis.setTimeout
  const clear = globalThis.clearTimeout
  const trackedSet = ((fn: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    const due = Date.now() + (delay ?? 0)
    const id = set(() => {
      scheduled.delete(Number(id))
      fn(...args)
    }, delay, ...args)
    scheduled.set(Number(id), due)
    return id
  }) as typeof setTimeout
  globalThis.setTimeout = trackedSet
  globalThis.clearTimeout = ((id: number) => {
    scheduled.delete(Number(id))
    return clear(id)
  }) as typeof clearTimeout
  restoreTimers = () => {
    globalThis.setTimeout = set
    globalThis.clearTimeout = clear
    scheduled = new Map()
    restoreTimers = undefined
  }
}

async function settle(rounds = 50) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

async function advance(ms: number) {
  const target = Date.now() + ms
  for (;;) {
    await settle()
    const due = [...scheduled.values()].filter((time) => time <= target).sort((a, b) => a - b)[0]
    if (due === undefined) break
    if (due <= Date.now()) jest.advanceTimersToNextTimer()
    else jest.advanceTimersByTime(due - Date.now())
  }
  const remaining = target - Date.now()
  if (remaining > 0) jest.advanceTimersByTime(remaining)
  await settle()
}
type PendingInputs = (Awaited<ReturnType<LoopSessionClient["inbox"]["list"]>>[number] & { sessionID?: string })[]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function holdNextAdmission(admit: ReturnType<typeof setup>["admit"]) {
  const admission = deferred<void>()
  const send = admit.getMockImplementation()!
  admit.mockImplementationOnce(async (input) => {
    await admission.promise
    return send(input)
  })
  return admission.resolve
}

function holdNextDiagnosticSave(storage: LoopStorage) {
  const saving = deferred<void>()
  const save = mocked(storage.set).getMockImplementation()!
  mocked(storage.set).mockImplementationOnce(async (key, value) => {
    await saving.promise
    await save(key, value)
  })
  return saving.resolve
}

function setup(
  directory = "/project",
  saved = new Map<string, Parameters<LoopStorage["set"]>[1]>(),
  pending: PendingInputs = [],
  createLoop = createOrchestratorLoop,
) {
  const storage: LoopStorage = {
    get: jest.fn(async (key) => structuredClone(saved.get(key))),
    set: jest.fn(async (key, value) => { saved.set(key, structuredClone(value)) }),
    remove: jest.fn(async (key) => { saved.delete(key) }),
    scan: jest.fn(async ({ prefix }) => ({
      entries: [...saved].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    })),
  }
  const get = jest.fn<LoopSessionClient["get"]>(async () => ({ id: "ses_parent", agent: "orchestrator" }))
  const delivered: PendingInputs = []
  let messageCount = 0
  const admit = jest.fn<LoopSessionClient["synthetic"]>(async (input) => {
    const item = {
      id: input.id ?? `msg_${++messageCount}`,
      sessionID: input.sessionID,
      type: "synthetic",
      payload: { text: input.text, description: input.description, metadata: input.metadata },
    }
    pending.push(item)
    return { id: item.id }
  })
  const wake = jest.fn(async (_input: Parameters<LoopSessionClient["synthetic"]>[0]) => {})
  const synthetic = jest.fn<LoopSessionClient["synthetic"]>(async (input) => {
    const existing = [...pending, ...delivered].find((item) => item.id === input.id && item.sessionID === input.sessionID)
    const reminder = existing ?? await admit(input)
    if (input.resume) await wake(input)
    return { id: reminder.id }
  })
  const inbox = {
    list: jest.fn(async ({ sessionID }: { sessionID: string }) => pending.filter((item) => !item.sessionID || item.sessionID === sessionID)),
    cancel: jest.fn(async ({ inboxID }: { sessionID: string; inboxID: string }) => {
      const index = pending.findIndex((item) => item.id === inboxID)
      if (index !== -1) pending.splice(index, 1)
    }),
  }
  const loop = createLoop({ directory, storage, session: { get, synthetic, inbox } })
  loops.push(loop)
  return { loop, saved, storage, get, synthetic, admit, wake, inbox, pending, delivered }
}

describe("orchestrator loop", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-10-12T10:00:00Z") })
    trackTimers()
  })

  afterEach(async () => {
    await Promise.all(loops.splice(0).map((loop) => loop.close()))
    jest.clearAllTimers()
    jest.useRealTimers()
    restoreTimers?.()
  })

  it("reports a disabled loop without admitting inputs or writing storage", async () => {
    const { loop, synthetic, storage } = setup()

    const status = await loop.status("ses_parent")

    expect(status).toMatchObject({ enabled: false, state: "disabled", objective: null, scheduler: { loadedHere: false, nextCheckAt: null }, pending: { state: "verified", ids: [] } })
    expect(synthetic).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it("reports the current objective and actual next check without changing cadence", async () => {
    const { loop, saved, storage } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    const deadline = Date.now() + 10 * MINUTE
    const original = structuredClone([...saved])
    mocked(storage.set).mockClear()
    await advance(3 * MINUTE)

    const status = await loop.status("ses_parent")

    expect(status).toMatchObject({ enabled: true, state: "scheduled", objective: "Finish the port", intervalMinutes: 10, ownerDirectory: "/project", scheduler: { loadedHere: true, nextCheckAt: deadline } })
    expect([...saved]).toEqual(original)
    expect(storage.set).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(1)
  })

  it("reports suspension when another agent is selected", async () => {
    const { loop, get } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    get.mockResolvedValue({ agent: "build" })

    expect(await loop.status("ses_parent")).toMatchObject({ enabled: true, state: "paused", selectedAgent: "build", suspensionReason: "different-agent" })
  })

  it("does not imply a different location's scheduler is loaded", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    const other = setup("/other-project", first.saved)

    expect(await other.loop.status("ses_parent")).toMatchObject({ enabled: true, state: "not-loaded-here", ownerDirectory: "/project", scheduler: { loadedHere: false, nextCheckAt: null } })
  })

  it("records reminder admission separately from a failed wake request", async () => {
    const { loop, wake } = setup()
    wake.mockRejectedValueOnce(new Error("Wake unavailable"))
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)

    expect(await loop.status("ses_parent")).toMatchObject({
      pending: { state: "verified", ids: ["msg_1"] },
      diagnostics: {
        lastReminderAdmitted: { inboxID: "msg_1", at: Date.now() },
        lastWakeRequested: null,
        lastError: { message: "Error: Wake unavailable", at: Date.now() },
      },
    })
  })

  it("restores saved diagnostics alongside the original cadence", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    const admittedAt = Date.now()
    await first.loop.close()
    const restored = setup("/project", first.saved, first.pending)
    await restored.loop.restore()

    expect(await restored.loop.status("ses_parent")).toMatchObject({
      state: "scheduled",
      scheduler: { nextCheckAt: admittedAt + 10 * MINUTE },
      diagnostics: {
        lastReminderAdmitted: { inboxID: "msg_1", at: admittedAt },
        lastWakeRequested: { inboxID: "msg_1", at: admittedAt },
      },
    })
    expect(restored.synthetic).not.toHaveBeenCalled()
  })

  it("preserves the last delivery error across plugin restoration", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    first.inbox.list.mockRejectedValueOnce(new Error("CLI unavailable"))
    await advance(10 * MINUTE)
    await first.loop.close()
    const restored = setup("/project", first.saved)
    await restored.loop.restore()

    expect(await restored.loop.status("ses_parent")).toMatchObject({ diagnostics: { lastError: { message: "Error: CLI unavailable" } } })
  })

  it("retains original admission diagnostics when a restored loop wakes a pending reminder", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    const admittedAt = Date.now()
    await first.loop.close()
    const restored = setup("/project", first.saved, first.pending)
    await restored.loop.restore()
    await advance(10 * MINUTE)

    expect(await restored.loop.status("ses_parent")).toMatchObject({ diagnostics: {
      lastReminderAdmitted: { at: admittedAt, inboxID: "msg_1" },
      lastWakeRequested: { at: Date.now(), inboxID: "msg_1" },
    } })
  })

  it("retains the last failure as history after a successful retry", async () => {
    const { loop, wake } = setup()
    wake.mockRejectedValueOnce(new Error("Wake unavailable"))
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    const failedAt = Date.now()
    await advance(10 * MINUTE)

    expect(await loop.status("ses_parent")).toMatchObject({ diagnostics: {
      lastWakeRequested: { at: Date.now() },
      lastError: { at: failedAt, message: "Error: Wake unavailable" },
    } })
  })

  it("does not rewrite saved diagnostics during paused checks", async () => {
    const { loop, storage, get } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    mocked(storage.set).mockClear()
    get.mockResolvedValue({ agent: "build" })

    await advance(10 * MINUTE)

    expect(storage.set).not.toHaveBeenCalled()
  })

  it("reports disabled status and clears diagnostics after stopping", async () => {
    const { loop, saved } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    await loop.stop("ses_parent")

    expect(await loop.status("ses_parent")).toMatchObject({ enabled: false, state: "disabled", suspensionReason: null, diagnostics: { lastReminderAdmitted: null } })
    expect(saved.size).toBe(0)
  })

  it("reports corrupt diagnostics without pretending they are absent", async () => {
    const { loop, saved } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    saved.set("orchestrator-diagnostics/ses_parent", { version: 1, revision: "old", lastError: { at: "invalid", message: "broken" } })

    expect(await loop.status("ses_parent")).toMatchObject({ diagnostics: { readError: expect.stringContaining("Invalid") } })
  })

  it("waits for in-flight diagnostic persistence before clearing stopped state", async () => {
    const { loop, storage, saved } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    const releaseSave = holdNextDiagnosticSave(storage)
    await advance(10 * MINUTE)
    let stopped = false
    const stopping = loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await advance(0)
      expect(stopped).toBe(false)
    } finally {
      releaseSave()
      await stopping
    }

    expect(saved.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("still cancels pending reminders when clearing diagnostic storage fails", async () => {
    const { loop, storage, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    const remove = mocked(storage.remove).getMockImplementation()!
    mocked(storage.remove).mockImplementation(async (key) => {
      if (key.startsWith("orchestrator-diagnostics/")) throw new Error("Diagnostic cleanup failed")
      await remove(key)
    })

    await expect(loop.stop("ses_parent")).rejects.toThrow("Diagnostic cleanup failed")

    expect(pending).toHaveLength(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each([false, true])("schedules and wakes despite diagnostic cleanup failure (reconfiguration: %s)", async (reconfigure) => {
    const { loop, storage, wake } = setup()
    if (reconfigure) await loop.start("ses_parent", { objective: "Old objective" })
    const remove = mocked(storage.remove).getMockImplementation()!
    mocked(storage.remove).mockImplementation(async (key) => {
      if (key.startsWith("orchestrator-diagnostics/")) throw new Error("Diagnostic cleanup failed")
      await remove(key)
    })

    await expect(loop.start("ses_parent", { objective: "New objective", intervalMinutes: 1 })).resolves.toMatchObject({ changed: true })
    await advance(0)

    expect(await loop.status("ses_parent")).toMatchObject({ enabled: true, state: "scheduled", diagnostics: { persistenceError: "Error: Diagnostic cleanup failed" } })
    await advance(MINUTE)
    expect(wake).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])("keeps core wakes independent of a delayed diagnostic save (reload: %s)", async (reload) => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 })
    const releaseSave = holdNextDiagnosticSave(first.storage)
    await advance(MINUTE)
    const admittedAt = Date.now()
    let closing: Promise<void> | undefined
    const next = reload ? setup("/project", first.saved, first.pending) : first
    try {
      if (reload) {
        closing = first.loop.close()
        await next.loop.restore()
      }
      await advance(MINUTE)

      const wakeCount = first.wake.mock.calls.length + (reload ? next.wake.mock.calls.length : 0)
      expect(wakeCount).toBe(2)
      expect(await next.loop.status("ses_parent")).toMatchObject({ scheduler: { nextCheckAt: Date.now() + MINUTE } })
    } finally {
      releaseSave()
      await closing
      await advance(0)
    }

    expect(await next.loop.status("ses_parent")).toMatchObject({ diagnostics: {
      lastReminderAdmitted: { at: admittedAt, inboxID: "msg_1" },
      lastWakeRequested: { at: Date.now(), inboxID: "msg_1" },
    } })
  })

  it("does not delay enablement or reminders while diagnostic cleanup is pending", async () => {
    const { loop, storage, wake } = setup()
    const cleaning = deferred<void>()
    const remove = mocked(storage.remove).getMockImplementation()!
    mocked(storage.remove).mockImplementation(async (key) => {
      if (key.startsWith("orchestrator-diagnostics/")) await cleaning.promise
      await remove(key)
    })
    let enabled = false
    const starting = loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 }).then(() => { enabled = true })
    try {
      await advance(0)
      expect(enabled).toBe(true)
      await advance(MINUTE)

      expect(wake).toHaveBeenCalledTimes(1)
      expect(await loop.status("ses_parent")).toMatchObject({ diagnostics: { persistencePending: true } })
    } finally {
      cleaning.resolve()
      await starting
      await advance(0)
    }
  })

  it("reconfigures during a delayed diagnostic save without losing new-revision diagnostics", async () => {
    const { loop, storage, saved, wake } = setup()
    await loop.start("ses_parent", { objective: "First", intervalMinutes: 1 })
    const releaseSave = holdNextDiagnosticSave(storage)
    await advance(MINUTE)
    let reconfigured = false
    const starting = loop.start("ses_parent", { objective: "Second", intervalMinutes: 1 }).then(() => { reconfigured = true })
    try {
      await advance(0)
      expect(reconfigured).toBe(true)
      await advance(MINUTE)

      expect(wake).toHaveBeenCalledTimes(2)
    } finally {
      releaseSave()
      await starting
      await advance(0)
    }

    const config = saved.get("orchestrator-loop/ses_parent")
    const diagnostics = saved.get("orchestrator-diagnostics/ses_parent")
    expect(diagnostics).toMatchObject({ revision: (config as { revision: string }).revision, lastReminderAdmitted: { inboxID: "msg_2" } })
    expect(await loop.status("ses_parent")).toMatchObject({ objective: "Second", diagnostics: { lastWakeRequested: { inboxID: "msg_2" }, persistencePending: false } })
  })

  it("cancels pending reminders before awaiting slow diagnostic cleanup at stop", async () => {
    const { loop, storage, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 })
    await advance(MINUTE)
    const cleaning = deferred<void>()
    const remove = mocked(storage.remove).getMockImplementation()!
    mocked(storage.remove).mockImplementation(async (key) => {
      if (key.startsWith("orchestrator-diagnostics/")) await cleaning.promise
      await remove(key)
    })
    const stopping = loop.stop("ses_parent")
    try {
      await advance(0)

      expect(pending).toHaveLength(0)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      cleaning.resolve()
      await stopping
    }
  })

  it("flushes the latest coalesced observation during graceful close", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 })
    const releaseSave = holdNextDiagnosticSave(first.storage)
    await advance(2 * MINUTE)
    const latestWake = Date.now()
    const closing = first.loop.close()
    releaseSave()
    await closing
    const restored = setup("/project", first.saved, first.pending)
    await restored.loop.restore()

    expect(await restored.loop.status("ses_parent")).toMatchObject({ diagnostics: { lastWakeRequested: { at: latestWake } } })
  })

  it("drains diagnostic operations spawned by an in-flight reminder during close", async () => {
    const { loop, admit, storage } = setup()
    await loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 })
    const releaseAdmission = holdNextAdmission(admit)
    const releaseSave = holdNextDiagnosticSave(storage)
    await advance(MINUTE)
    let closed = false
    const closing = loop.close().then(() => { closed = true })
    releaseAdmission()
    try {
      await advance(0)

      expect(closed).toBe(false)
    } finally {
      releaseSave()
      await closing
    }
  })

  it("makes a final attempt to flush buffered observations after an earlier save failure", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 })
    mocked(first.storage.set).mockRejectedValueOnce(new Error("Transient failure"))
    await advance(MINUTE)

    await first.loop.close()
    const restored = setup("/project", first.saved, first.pending)
    await restored.loop.restore()

    expect(await restored.loop.status("ses_parent")).toMatchObject({ diagnostics: { lastReminderAdmitted: { at: Date.now(), inboxID: "msg_1" } } })
  })

  it("does not let an older runtime observation hide newer persisted status", async () => {
    const { loop, storage, saved } = setup()
    await loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 })
    const releaseSave = holdNextDiagnosticSave(storage)
    await advance(MINUTE)
    const revision = (saved.get("orchestrator-loop/ses_parent") as { revision: string }).revision
    jest.setSystemTime(Date.now() + 1)
    saved.set("orchestrator-diagnostics/ses_parent", { version: 1, revision, lastWakeRequested: { at: Date.now(), inboxID: "msg_newer" } })
    try {
      expect(await loop.status("ses_parent")).toMatchObject({ diagnostics: { lastWakeRequested: { at: Date.now(), inboxID: "msg_newer" } } })
    } finally {
      releaseSave()
      await advance(0)
    }
  })

  it.each([false, true])("merges late old-manager saves without regressing newer events (new wake fails: %s)", async (failWake) => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port", intervalMinutes: 1 })
    const releaseSave = holdNextDiagnosticSave(first.storage)
    await advance(MINUTE)
    first.pending.splice(0)
    await advance(MINUTE)
    const oldWakeAt = Date.now()
    first.inbox.list.mockRejectedValueOnce(new Error("Old delivery failed"))
    await advance(MINUTE)
    const oldErrorAt = Date.now()
    const closing = first.loop.close()
    const next = setup("/project", first.saved, first.pending)
    next.pending.splice(0)
    if (failWake) next.wake.mockRejectedValueOnce(new Error("New delivery failed"))
    try {
      await next.loop.restore()
      await advance(MINUTE)
    } finally {
      releaseSave()
      await closing
      await advance(0)
    }

    const restored = setup("/project", first.saved, first.pending)
    await restored.loop.restore()
    expect(await restored.loop.status("ses_parent")).toMatchObject({ diagnostics: {
      lastReminderAdmitted: { at: Date.now() },
      lastWakeRequested: { at: failWake ? oldWakeAt : Date.now() },
      lastError: { at: failWake ? Date.now() : oldErrorAt, message: failWake ? "Error: New delivery failed" : "Error: Old delivery failed" },
    } })
  })

  it("does not reuse an earlier objective's diagnostics after settings change", async () => {
    const { loop } = setup()
    await loop.start("ses_parent", { objective: "First" })
    await advance(10 * MINUTE)
    await loop.start("ses_parent", { objective: "Second" })

    expect(await loop.status("ses_parent")).toMatchObject({ objective: "Second", diagnostics: { lastReminderAdmitted: null, lastWakeRequested: null, lastError: null } })
  })

  it("reports failed inbox inspection as unavailable rather than empty", async () => {
    const { loop, inbox } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    inbox.list.mockRejectedValueOnce(new Error("CLI offline"))

    expect(await loop.status("ses_parent")).toMatchObject({ pending: { state: "unavailable", error: "Error: CLI offline" } })
  })

  it("reports failed agent inspection without assuming the loop can remind", async () => {
    const { loop, get } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    get.mockRejectedValueOnce(new Error("Session lookup failed"))

    expect(await loop.status("ses_parent")).toMatchObject({ enabled: true, state: "unknown", sessionError: "Error: Session lookup failed" })
  })

  it("keeps reminders working and exposes diagnostic persistence failures", async () => {
    const { loop, storage, wake } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    mocked(storage.set).mockRejectedValueOnce(new Error("Diagnostic storage failed"))
    await advance(10 * MINUTE)

    expect(wake).toHaveBeenCalledTimes(1)
    expect(await loop.status("ses_parent")).toMatchObject({ diagnostics: { persistenceError: "Error: Diagnostic storage failed", lastReminderAdmitted: { inboxID: "msg_1" } } })
  })

  it("exposes a read-only public status tool for the invoking session", async () => {
    const { loop, synthetic } = setup()
    const { statusTool } = createOrchestratorLoopTools(loop)

    const result = await statusTool.execute({}, { sessionID: "ses_parent" })

    expect(statusTool.name).toBe("orchestrator-status")
    expect(JSON.parse(result.content)).toMatchObject({ sessionID: "ses_parent", state: "disabled" })
    expect(synthetic).not.toHaveBeenCalled()
  })

  it("enables and disables reminders through the public tools in the invoking session", async () => {
    const { loop, admit, pending } = setup()
    const { startTool, stopTool } = createOrchestratorLoopTools(loop)
    await startTool.execute({ objective: "Finish the port", intervalMinutes: 1 }, { sessionID: "ses_parent" })
    await advance(MINUTE)

    await stopTool.execute({}, { sessionID: "ses_parent" })
    await advance(MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(admit.mock.calls[0][0].sessionID).toBe("ses_parent")
    expect(pending).toHaveLength(0)
  })

  it("steers the current orchestrator after ten minutes with a coordination check", async () => {
    const { loop, admit, wake } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    await advance(10 * MINUTE - 1)
    expect(admit).not.toHaveBeenCalled()
    await advance(1)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: "ses_parent",
      delivery: "steer",
      resume: false,
      text: expect.stringContaining("Periodic coordination check:"),
    }))
    expect(wake).toHaveBeenCalledWith({ ...admit.mock.calls[0][0], id: "msg_1", resume: true })
  })

  it("reminds the orchestrator to reconcile and safely release temporary workspaces", async () => {
    const { loop, admit } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    await advance(10 * MINUTE)

    const text = admit.mock.calls[0][0].text
    expect(text).toContain("Reconcile temporary workspaces and release eligible ones following the workspace lifecycle")
    expect(text).toContain("Reconcile meaningful changes with the reference backlog and verify updates were saved")
  })

  it("keeps only one reminder pending while the orchestrator is busy", async () => {
    const { loop, admit, wake, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    await advance(30 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(pending).toHaveLength(1)
    expect(wake).toHaveBeenCalledTimes(3)
  })

  it("replaces the existing cadence and cancels its old pending reminder", async () => {
    const { loop, admit, pending, saved } = setup()
    await loop.start("ses_parent", { objective: "First objective" })
    await advance(10 * MINUTE)

    await loop.start("ses_parent", { objective: "Revised objective", intervalMinutes: 2 })
    expect(pending).toHaveLength(0)
    await advance(2 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(2)
    expect(saved.get("orchestrator-loop/ses_parent")).toMatchObject({ objective: "Revised objective", intervalMinutes: 2 })
    expect(jest.getTimerCount()).toBe(1)
  })

  it("preserves the original deadline when the same normalized settings are started again", async () => {
    const { loop, saved, storage, admit } = setup()
    expect(await loop.start("ses_parent", { objective: "Finish the port" })).toMatchObject({ changed: true })
    const original = structuredClone(saved.get("orchestrator-loop/ses_parent"))
    await advance(9 * MINUTE)

    expect(await loop.start("ses_parent", { objective: "  Finish the port  ", intervalMinutes: 10 })).toMatchObject({ changed: false })
    expect(saved.get("orchestrator-loop/ses_parent")).toEqual(original)
    expect(storage.set).toHaveBeenCalledTimes(1)
    await advance(MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
  })

  it("does not cancel a pending reminder on an identical start", async () => {
    const { loop, inbox, pending, admit, wake } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    const reminder = structuredClone(pending[0])
    inbox.cancel.mockClear()

    await loop.start("ses_parent", { objective: "Finish the port" })

    expect(inbox.cancel).not.toHaveBeenCalled()
    expect(pending).toEqual([reminder])
    await advance(10 * MINUTE)
    expect(admit).toHaveBeenCalledTimes(1)
    expect(wake).toHaveBeenCalledTimes(2)
  })

  it("leaves an in-flight admission running on an identical start", async () => {
    const { loop, admit, wake, pending } = setup()
    const releaseAdmission = holdNextAdmission(admit)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    let unchanged = false
    const starting = loop.start("ses_parent", { objective: "Finish the port" }).then((result) => {
      unchanged = !result.changed
    })
    try {
      await advance(0)
      expect(unchanged).toBe(true)
    } finally {
      releaseAdmission()
      await starting
      await advance(0)
    }

    expect(wake).toHaveBeenCalledTimes(1)
    expect(pending).toHaveLength(1)
  })

  it("reactivates an identical persisted loop without resetting its deadline", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    const original = structuredClone(first.saved.get("orchestrator-loop/ses_parent"))
    await first.loop.close()
    await advance(9 * MINUTE)
    const restored = setup("/project", first.saved)

    expect(await restored.loop.start("ses_parent", { objective: "Finish the port" })).toMatchObject({ changed: false })
    expect(restored.saved.get("orchestrator-loop/ses_parent")).toEqual(original)
    expect(restored.storage.set).not.toHaveBeenCalled()
    await advance(MINUTE)

    expect(restored.admit).toHaveBeenCalledTimes(1)
  })

  it("replaces an invalid persisted schedule even when its settings match", async () => {
    const { loop, saved, admit } = setup()
    saved.set("orchestrator-loop/ses_parent", {
      version: 1, sessionID: "ses_parent", directory: "/project", objective: "Finish the port",
      intervalMinutes: 10, startedAt: "invalid", revision: "invalid-schedule",
    })

    expect(await loop.start("ses_parent", { objective: "Finish the port" })).toMatchObject({ changed: true })
    await advance(10 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(saved.get("orchestrator-loop/ses_parent")).toMatchObject({ startedAt: expect.any(Number) })
  })

  it("coalesces concurrent starts with identical settings", async () => {
    const { loop, storage } = setup()

    const results = await Promise.all([
      loop.start("ses_parent", { objective: "Finish the port" }),
      loop.start("ses_parent", { objective: "Finish the port" }),
    ])

    expect(results.map((result) => result.changed)).toEqual([true, false])
    expect(storage.set).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
  })

  it("moves cadence ownership when identical settings are started from a different location", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    const other = setup("/other-project", first.saved, first.pending)

    expect(await other.loop.start("ses_parent", { objective: "Finish the port" })).toMatchObject({ changed: true })
    await advance(10 * MINUTE)

    expect(first.admit).not.toHaveBeenCalled()
    expect(other.admit).toHaveBeenCalledTimes(1)
    expect(other.saved.get("orchestrator-loop/ses_parent")).toMatchObject({ directory: "/other-project" })
  })

  it("reports an unchanged public start without promising a postponed first reminder", async () => {
    const { loop } = setup()
    const { startTool } = createOrchestratorLoopTools(loop)
    await startTool.execute({ objective: "Finish the port" }, { sessionID: "ses_parent" })

    const result = await startTool.execute({ objective: "Finish the port" }, { sessionID: "ses_parent" })

    expect(result.content).toContain("unchanged")
    expect(result.content).toContain("cadence preserved")
    expect(result.content).not.toContain("first reminder arrives after")
  })

  it("stops reminders and cancels only this loop's pending input", async () => {
    const { loop, admit, pending } = setup()
    pending.push({ id: "msg_user", type: "user", payload: {} })
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)

    await loop.stop("ses_parent")
    await advance(30 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(pending.map((item) => item.id)).toEqual(["msg_user"])
  })

  it("restores the persisted cadence without replaying missed intervals", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await first.loop.close()
    await advance(125 * MINUTE)
    const restored = setup("/project", first.saved)

    await restored.loop.restore()
    expect(restored.synthetic).not.toHaveBeenCalled()
    await advance(5 * MINUTE)

    expect(restored.admit).toHaveBeenCalledTimes(1)
    expect(restored.admit.mock.calls[0][0].sessionID).toBe("ses_parent")
  })

  it("does not restore an explicitly stopped loop", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await first.loop.stop("ses_parent")
    await first.loop.close()
    const restored = setup("/project", first.saved)

    await restored.loop.restore()
    await advance(20 * MINUTE)

    expect(restored.synthetic).not.toHaveBeenCalled()
  })

  it("does not restore another location's loop from shared plugin storage", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    const other = setup("/other-project", first.saved)

    await other.loop.restore()
    await advance(10 * MINUTE)

    expect(first.admit).toHaveBeenCalledTimes(1)
    expect(other.synthetic).not.toHaveBeenCalled()
  })

  it("coalesces a durable reminder left pending before a reload", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    await first.loop.close()
    const restored = setup("/project", first.saved)
    restored.pending.push(...first.pending)

    await restored.loop.restore()
    await advance(10 * MINUTE)

    expect(restored.admit).not.toHaveBeenCalled()
    expect(restored.wake).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: "ses_parent", id: "msg_1", text: first.admit.mock.calls[0][0].text, resume: true,
    }))
  })

  it("keeps reminders short even when the established objective is long", async () => {
    const { loop, admit } = setup()
    await loop.start("ses_parent", { objective: "A detailed project objective. ".repeat(2000) })

    await advance(10 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(admit.mock.calls[0][0].text.length).toBeLessThan(1000)
  })

  it("replaces a legacy snapshot reminder left pending before a reload", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    await first.loop.close()
    const legacy = first.pending[0]
    legacy.id = "msg_legacy"
    legacy.payload = { ...first.admit.mock.calls[0][0], text: "Child activity snapshot\n".repeat(2000) }
    const restored = setup("/project", first.saved, first.pending)

    await restored.loop.restore()
    await advance(10 * MINUTE)

    expect(restored.inbox.cancel).toHaveBeenCalledWith({ sessionID: "ses_parent", inboxID: "msg_legacy" })
    expect(restored.pending).toHaveLength(1)
    expect(restored.admit).toHaveBeenCalledTimes(1)
    expect(restored.admit.mock.calls[0][0].text.length).toBeLessThan(1000)
    expect(restored.wake).toHaveBeenCalledWith(expect.objectContaining({ id: restored.pending[0].id, resume: true }))
  })

  it("cancels a reminder whose admission finishes while stop is waiting", async () => {
    const { loop, admit, wake, pending } = setup()
    const releaseAdmission = holdNextAdmission(admit)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    expect(admit).toHaveBeenCalledTimes(1)

    const stopping = loop.stop("ses_parent")
    await advance(0)
    releaseAdmission()
    await stopping

    expect(wake).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("does not send a reminder after an inbox lookup finishes during plugin cleanup", async () => {
    const { loop, inbox, synthetic, saved } = setup()
    const inspection = deferred<PendingInputs>()
    await loop.start("ses_parent", { objective: "Finish the port" })
    inbox.list.mockReturnValueOnce(inspection.promise)
    await advance(10 * MINUTE)

    const closing = loop.close()
    inspection.resolve([])
    await closing

    expect(synthetic).not.toHaveBeenCalled()
    expect(saved.size).toBe(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("waits for a late admission when stop and plugin cleanup happen together", async () => {
    const { loop, admit, pending } = setup()
    const releaseAdmission = holdNextAdmission(admit)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)

    let stopped = false
    const stopping = loop.stop("ses_parent").then(() => { stopped = true })
    const closing = loop.close()
    try {
      await advance(0)
      expect(stopped).toBe(false)
    } finally {
      releaseAdmission()
      await Promise.all([stopping, closing])
    }

    expect(pending).toHaveLength(0)
  })

  it("observes an explicit stop issued from another loaded location", async () => {
    const first = setup()
    const inspection = deferred<PendingInputs>()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    first.inbox.list.mockReturnValueOnce(inspection.promise)
    await advance(10 * MINUTE)
    const other = setup("/other-project", first.saved)

    const stopping = other.loop.stop("ses_parent")
    await advance(0)
    inspection.resolve([])
    await stopping
    await advance(20 * MINUTE)

    expect(first.synthetic).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each([false, true])("waits for the owner's late admission from another location (separate module: %s)", async (separateModule) => {
    const first = setup()
    const specifier = "./orchestrator-loop?separate"
    const createLoop = separateModule ? ((await import(specifier)) as typeof import("./orchestrator-loop")).createOrchestratorLoop : createOrchestratorLoop
    const other = setup("/other-project", first.saved, first.pending, createLoop)
    const releaseAdmission = holdNextAdmission(first.admit)
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    expect(first.admit).toHaveBeenCalledTimes(1)

    let stopped = false
    const stopping = other.loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await advance(0)
      expect(stopped).toBe(false)
    } finally {
      releaseAdmission()
      await stopping
    }

    expect(first.wake).not.toHaveBeenCalled()
    expect(first.pending).toHaveLength(0)
    expect(first.saved.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each([false, true])("cancels a reminder when stopped during its final agent check (delayed removal: %s)", async (delayedRemoval) => {
    const first = setup()
    const other = setup("/other-project", first.saved, first.pending)
    const agentCheck = deferred<unknown>()
    const send = first.admit.getMockImplementation()!
    first.admit.mockImplementationOnce(async (input) => {
      const reminder = await send(input)
      first.get.mockReturnValueOnce(agentCheck.promise)
      return reminder
    })
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    expect(first.pending).toHaveLength(1)

    const removal = deferred<void>()
    if (delayedRemoval) {
      const remove = mocked(other.storage.remove).getMockImplementation()!
      mocked(other.storage.remove).mockImplementationOnce(async (key) => {
        await removal.promise
        await remove(key)
      })
    }
    const stopping = other.loop.stop("ses_parent")
    try {
      await advance(0)
      agentCheck.resolve({ agent: "orchestrator" })
      await advance(0)

      expect(first.wake).not.toHaveBeenCalled()
    } finally {
      agentCheck.resolve({ agent: "orchestrator" })
      removal.resolve()
      await stopping
    }

    expect(first.pending).toHaveLength(0)
    expect(first.saved.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("waits for an admission on owner cleanup after another location cancels it", async () => {
    const first = setup()
    const other = setup("/other-project", first.saved, first.pending)
    const releaseAdmission = holdNextAdmission(first.admit)
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)

    const stopping = other.loop.stop("ses_parent")
    await advance(0)
    let closed = false
    const closing = first.loop.close().then(() => { closed = true })
    try {
      await advance(0)
      expect(closed).toBe(false)
    } finally {
      releaseAdmission()
      await Promise.all([stopping, closing])
    }

    expect(first.wake).not.toHaveBeenCalled()
    expect(first.pending).toHaveLength(0)
  })

  it("retries waking the existing durable reminder after a wake failure", async () => {
    const { loop, admit, wake, pending } = setup()
    wake.mockRejectedValueOnce(new Error("Wake unavailable"))
    await loop.start("ses_parent", { objective: "Finish the port" })

    await advance(20 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(pending).toHaveLength(1)
    expect(wake).toHaveBeenCalledTimes(2)
    expect(wake.mock.calls[1][0].id).toBe(wake.mock.calls[0][0].id)
  })

  it("does not duplicate a reminder delivered before its wake request", async () => {
    const { loop, admit, wake, pending, delivered } = setup()
    const send = admit.getMockImplementation()!
    admit.mockImplementationOnce(async (input) => {
      const reminder = await send(input)
      delivered.push(...pending.splice(0))
      return reminder
    })
    await loop.start("ses_parent", { objective: "Finish the port" })

    await advance(10 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(delivered).toHaveLength(1)
    expect(pending).toHaveLength(0)
    expect(wake).toHaveBeenCalledWith(expect.objectContaining({ id: delivered[0].id, resume: true }))
  })

  it("waits for an in-flight wake before completing a cross-location stop", async () => {
    const first = setup()
    const other = setup("/other-project", first.saved, first.pending)
    const waking = deferred<void>()
    first.wake.mockReturnValueOnce(waking.promise)
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    expect(first.wake).toHaveBeenCalledTimes(1)

    let stopped = false
    const stopping = other.loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await advance(0)
      expect(stopped).toBe(false)
    } finally {
      waking.resolve()
      await stopping
    }

    expect(first.pending).toHaveLength(0)
    expect(first.saved.size).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it("continues coordinating after more than two hours", async () => {
    const { loop, admit, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    for (let interval = 0; interval < 13; interval++) {
      await advance(10 * MINUTE)
      pending.splice(0)
    }

    expect(admit).toHaveBeenCalledTimes(13)
  })

  it("keeps another orchestrator's loop running when one session is stopped", async () => {
    const { loop, admit } = setup()
    await loop.start("ses_a", { objective: "First project" })
    await loop.start("ses_b", { objective: "Second project" })
    await loop.stop("ses_a")

    await advance(10 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(admit.mock.calls[0][0].sessionID).toBe("ses_b")
  })

  it("serializes concurrent updates to the same session", async () => {
    const { loop, admit, saved } = setup()
    await Promise.all([
      loop.start("ses_parent", { objective: "First request", intervalMinutes: 2 }),
      loop.start("ses_parent", { objective: "Second request", intervalMinutes: 3 }),
    ])

    await advance(3 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(1)
    expect(saved.get("orchestrator-loop/ses_parent")).toMatchObject({ objective: "Second request", intervalMinutes: 3 })
    expect(jest.getTimerCount()).toBe(1)
  })

  it("serializes a cross-location stop behind an activation being persisted", async () => {
    const first = setup()
    const other = setup("/other-project", first.saved, first.pending)
    const persistence = deferred<void>()
    const save = first.storage.set
    const implementation = mocked(save).getMockImplementation()!
    mocked(save).mockImplementationOnce(async (key, value) => {
      await persistence.promise
      await implementation(key, value)
    })
    const starting = first.loop.start("ses_parent", { objective: "Finish the port" })
    await advance(0)
    expect(save).toHaveBeenCalledTimes(1)

    let stopped = false
    const stopping = other.loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await advance(0)
      expect(stopped).toBe(false)
    } finally {
      persistence.resolve()
      await Promise.all([starting, stopping])
    }
    await advance(10 * MINUTE)

    expect(first.saved.size).toBe(0)
    expect(first.synthetic).not.toHaveBeenCalled()
    expect(other.synthetic).not.toHaveBeenCalled()
  })

  it("coalesces overlapping reminder attempts during a location reload", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    const restored = setup("/project", first.saved, first.pending)
    await restored.loop.restore()
    const releaseAdmission = holdNextAdmission(first.admit)

    try {
      await advance(10 * MINUTE)
      expect(first.admit).toHaveBeenCalledTimes(1)
      expect(restored.synthetic).not.toHaveBeenCalled()
    } finally {
      releaseAdmission()
      await advance(0)
    }

    expect(first.pending).toHaveLength(1)
  })

  it.each(["SessionNotFoundError", "Session.NotFoundError"])("removes durable state when the target session reports %s", async (_tag) => {
    const { loop, get, saved, synthetic } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    get.mockRejectedValue({ _tag, sessionID: "ses_parent" })

    await advance(10 * MINUTE)

    expect(saved.size).toBe(0)
    expect(synthetic).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it("pauses reminders while another agent is selected in the session", async () => {
    const { loop, get, admit } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    get.mockResolvedValueOnce({ agent: "plan" })

    await advance(10 * MINUTE)
    expect(admit).not.toHaveBeenCalled()
    await advance(10 * MINUTE)
    expect(admit).toHaveBeenCalledTimes(1)
  })

  it("pauses admission when the agent switches during the inbox lookup", async () => {
    const { loop, get, inbox, synthetic, wake } = setup()
    const inspection = deferred<PendingInputs>()
    await loop.start("ses_parent", { objective: "Finish the port" })
    inbox.list.mockReturnValueOnce(inspection.promise)
    await advance(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    inspection.resolve([])
    await advance(0)

    expect(synthetic).not.toHaveBeenCalled()
    expect(wake).not.toHaveBeenCalled()
  })

  it("does not wake an existing reminder after an agent switch during inbox lookup", async () => {
    const { loop, get, inbox, wake, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)
    wake.mockClear()
    const inspection = deferred<PendingInputs>()
    inbox.list.mockReturnValueOnce(inspection.promise)
    await advance(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    inspection.resolve([...pending])
    await advance(0)

    expect(wake).not.toHaveBeenCalled()
  })

  it("cancels a reminder admitted during an agent switch without waking the new agent", async () => {
    const { loop, get, admit, wake, pending } = setup()
    const releaseAdmission = holdNextAdmission(admit)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await advance(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    releaseAdmission()
    await advance(0)

    expect(wake).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
  })

  it.each([0, -1, 0.5, NaN, Infinity, "10", null, 35792])("rejects invalid interval %s before accessing the session", async (intervalMinutes) => {
    const { loop, get, saved } = setup()

    await expect(loop.start("ses_parent", { objective: "Finish the port", intervalMinutes })).rejects.toThrow("intervalMinutes")

    expect(get).not.toHaveBeenCalled()
    expect(saved.size).toBe(0)
  })

  it.each(["", "   ", null, 123])("rejects invalid objective %s before accessing the session", async (objective) => {
    const { loop, get } = setup()

    await expect(loop.start("ses_parent", { objective })).rejects.toThrow("objective")

    expect(get).not.toHaveBeenCalled()
  })

  it("rejects activation from a child session", async () => {
    const { loop, get, saved } = setup()
    get.mockResolvedValue({ agent: "orchestrator", parentID: "ses_other" })

    await expect(loop.start("ses_parent", { objective: "Finish the port" })).rejects.toThrow("root orchestrator")

    expect(saved.size).toBe(0)
  })

  it("propagates a persistence failure without scheduling a timer", async () => {
    const { loop, storage } = setup()
    mocked(storage.set).mockRejectedValueOnce(new Error("Storage unavailable"))

    await expect(loop.start("ses_parent", { objective: "Finish the port" })).rejects.toThrow("Storage unavailable")

    expect(jest.getTimerCount()).toBe(0)
  })
})
