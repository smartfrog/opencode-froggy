import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createOrchestratorLoop, type LoopSessionClient, type LoopStorage } from "./orchestrator-loop"
import { createOrchestratorLoopTools } from "./tools/orchestrator-loop"

const MINUTE = 60_000
const loops: ReturnType<typeof createOrchestratorLoop>[] = []
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

function setup(
  directory = "/project",
  saved = new Map<string, Parameters<LoopStorage["set"]>[1]>(),
  pending: PendingInputs = [],
  createLoop = createOrchestratorLoop,
) {
  const storage: LoopStorage = {
    get: vi.fn(async (key) => structuredClone(saved.get(key))),
    set: vi.fn(async (key, value) => { saved.set(key, structuredClone(value)) }),
    remove: vi.fn(async (key) => { saved.delete(key) }),
    scan: vi.fn(async ({ prefix }) => ({
      entries: [...saved].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    })),
  }
  const get = vi.fn<LoopSessionClient["get"]>(async () => ({ id: "ses_parent", agent: "orchestrator" }))
  const delivered: PendingInputs = []
  let messageCount = 0
  const admit = vi.fn<LoopSessionClient["synthetic"]>(async (input) => {
    const item = {
      id: input.id ?? `msg_${++messageCount}`,
      sessionID: input.sessionID,
      type: "synthetic",
      payload: { text: input.text, description: input.description, metadata: input.metadata },
    }
    pending.push(item)
    return { id: item.id }
  })
  const wake = vi.fn(async (_input: Parameters<LoopSessionClient["synthetic"]>[0]) => {})
  const synthetic = vi.fn<LoopSessionClient["synthetic"]>(async (input) => {
    const existing = [...pending, ...delivered].find((item) => item.id === input.id && item.sessionID === input.sessionID)
    const reminder = existing ?? await admit(input)
    if (input.resume) await wake(input)
    return { id: reminder.id }
  })
  const inbox = {
    list: vi.fn(async ({ sessionID }: { sessionID: string }) => pending.filter((item) => !item.sessionID || item.sessionID === sessionID)),
    cancel: vi.fn(async ({ inboxID }: { sessionID: string; inboxID: string }) => {
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"))
  })

  afterEach(async () => {
    await Promise.all(loops.splice(0).map((loop) => loop.close()))
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("enables and disables reminders through the public tools in the invoking session", async () => {
    const { loop, admit, pending } = setup()
    const { startTool, stopTool } = createOrchestratorLoopTools(loop)
    await startTool.execute({ objective: "Finish the port", intervalMinutes: 1 }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(MINUTE)

    await stopTool.execute({}, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(MINUTE)

    expect(admit).toHaveBeenCalledOnce()
    expect(admit.mock.calls[0][0].sessionID).toBe("ses_parent")
    expect(pending).toHaveLength(0)
  })

  it("steers the current orchestrator after ten minutes with a coordination check", async () => {
    const { loop, admit, wake } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    await vi.advanceTimersByTimeAsync(10 * MINUTE - 1)
    expect(admit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(admit).toHaveBeenCalledOnce()
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

    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    const text = admit.mock.calls[0][0].text
    expect(text).toContain("Reconcile temporary workspaces and release eligible ones following the workspace lifecycle")
    expect(text).toContain("Reconcile meaningful changes with the reference backlog and verify updates were saved")
  })

  it("keeps only one reminder pending while the orchestrator is busy", async () => {
    const { loop, admit, wake, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    await vi.advanceTimersByTimeAsync(30 * MINUTE)

    expect(admit).toHaveBeenCalledOnce()
    expect(pending).toHaveLength(1)
    expect(wake).toHaveBeenCalledTimes(3)
  })

  it("replaces the existing cadence and cancels its old pending reminder", async () => {
    const { loop, admit, pending, saved } = setup()
    await loop.start("ses_parent", { objective: "First objective" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    await loop.start("ses_parent", { objective: "Revised objective", intervalMinutes: 2 })
    expect(pending).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2 * MINUTE)

    expect(admit).toHaveBeenCalledTimes(2)
    expect(saved.get("orchestrator-loop/ses_parent")).toMatchObject({ objective: "Revised objective", intervalMinutes: 2 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it("stops reminders and cancels only this loop's pending input", async () => {
    const { loop, admit, pending } = setup()
    pending.push({ id: "msg_user", type: "user", payload: {} })
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    await loop.stop("ses_parent")
    await vi.advanceTimersByTimeAsync(30 * MINUTE)

    expect(admit).toHaveBeenCalledOnce()
    expect(pending.map((item) => item.id)).toEqual(["msg_user"])
  })

  it("restores the persisted cadence without replaying missed intervals", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await first.loop.close()
    await vi.advanceTimersByTimeAsync(125 * MINUTE)
    const restored = setup("/project", first.saved)

    await restored.loop.restore()
    expect(restored.synthetic).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)

    expect(restored.admit).toHaveBeenCalledOnce()
    expect(restored.admit.mock.calls[0][0].sessionID).toBe("ses_parent")
  })

  it("does not restore an explicitly stopped loop", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await first.loop.stop("ses_parent")
    await first.loop.close()
    const restored = setup("/project", first.saved)

    await restored.loop.restore()
    await vi.advanceTimersByTimeAsync(20 * MINUTE)

    expect(restored.synthetic).not.toHaveBeenCalled()
  })

  it("does not restore another location's loop from shared plugin storage", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    const other = setup("/other-project", first.saved)

    await other.loop.restore()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(first.admit).toHaveBeenCalledOnce()
    expect(other.synthetic).not.toHaveBeenCalled()
  })

  it("coalesces a durable reminder left pending before a reload", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    await first.loop.close()
    const restored = setup("/project", first.saved)
    restored.pending.push(...first.pending)

    await restored.loop.restore()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(restored.admit).not.toHaveBeenCalled()
    expect(restored.wake).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: "ses_parent", id: "msg_1", text: first.admit.mock.calls[0][0].text, resume: true,
    }))
  })

  it("keeps reminders short even when the established objective is long", async () => {
    const { loop, admit } = setup()
    await loop.start("ses_parent", { objective: "A detailed project objective. ".repeat(2000) })

    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(admit).toHaveBeenCalledOnce()
    expect(admit.mock.calls[0][0].text.length).toBeLessThan(1000)
  })

  it("replaces a legacy snapshot reminder left pending before a reload", async () => {
    const first = setup()
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    await first.loop.close()
    const legacy = first.pending[0]
    legacy.id = "msg_legacy"
    legacy.payload = { ...first.admit.mock.calls[0][0], text: "Child activity snapshot\n".repeat(2000) }
    const restored = setup("/project", first.saved, first.pending)

    await restored.loop.restore()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(restored.inbox.cancel).toHaveBeenCalledWith({ sessionID: "ses_parent", inboxID: "msg_legacy" })
    expect(restored.pending).toHaveLength(1)
    expect(restored.admit).toHaveBeenCalledOnce()
    expect(restored.admit.mock.calls[0][0].text.length).toBeLessThan(1000)
    expect(restored.wake).toHaveBeenCalledWith(expect.objectContaining({ id: restored.pending[0].id, resume: true }))
  })

  it("cancels a reminder whose admission finishes while stop is waiting", async () => {
    const { loop, admit, wake, pending } = setup()
    const releaseAdmission = holdNextAdmission(admit)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(admit).toHaveBeenCalledOnce()

    const stopping = loop.stop("ses_parent")
    await vi.advanceTimersByTimeAsync(0)
    releaseAdmission()
    await stopping

    expect(wake).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not send a reminder after an inbox lookup finishes during plugin cleanup", async () => {
    const { loop, inbox, synthetic, saved } = setup()
    const inspection = deferred<PendingInputs>()
    await loop.start("ses_parent", { objective: "Finish the port" })
    inbox.list.mockReturnValueOnce(inspection.promise)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    const closing = loop.close()
    inspection.resolve([])
    await closing

    expect(synthetic).not.toHaveBeenCalled()
    expect(saved.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("waits for a late admission when stop and plugin cleanup happen together", async () => {
    const { loop, admit, pending } = setup()
    const releaseAdmission = holdNextAdmission(admit)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    let stopped = false
    const stopping = loop.stop("ses_parent").then(() => { stopped = true })
    const closing = loop.close()
    try {
      await vi.advanceTimersByTimeAsync(0)
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
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    const other = setup("/other-project", first.saved)

    const stopping = other.loop.stop("ses_parent")
    await vi.advanceTimersByTimeAsync(0)
    inspection.resolve([])
    await stopping
    await vi.advanceTimersByTimeAsync(20 * MINUTE)

    expect(first.synthetic).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])("waits for the owner's late admission from another location (separate module: %s)", async (separateModule) => {
    const first = setup()
    vi.resetModules()
    const createLoop = separateModule ? (await import("./orchestrator-loop")).createOrchestratorLoop : createOrchestratorLoop
    const other = setup("/other-project", first.saved, first.pending, createLoop)
    const releaseAdmission = holdNextAdmission(first.admit)
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(first.admit).toHaveBeenCalledOnce()

    let stopped = false
    const stopping = other.loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(stopped).toBe(false)
    } finally {
      releaseAdmission()
      await stopping
    }

    expect(first.wake).not.toHaveBeenCalled()
    expect(first.pending).toHaveLength(0)
    expect(first.saved.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
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
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(first.pending).toHaveLength(1)

    const removal = deferred<void>()
    if (delayedRemoval) {
      const remove = vi.mocked(other.storage.remove).getMockImplementation()!
      vi.mocked(other.storage.remove).mockImplementationOnce(async (key) => {
        await removal.promise
        await remove(key)
      })
    }
    const stopping = other.loop.stop("ses_parent")
    try {
      await vi.advanceTimersByTimeAsync(0)
      agentCheck.resolve({ agent: "orchestrator" })
      await vi.advanceTimersByTimeAsync(0)

      expect(first.wake).not.toHaveBeenCalled()
    } finally {
      agentCheck.resolve({ agent: "orchestrator" })
      removal.resolve()
      await stopping
    }

    expect(first.pending).toHaveLength(0)
    expect(first.saved.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("waits for an admission on owner cleanup after another location cancels it", async () => {
    const first = setup()
    const other = setup("/other-project", first.saved, first.pending)
    const releaseAdmission = holdNextAdmission(first.admit)
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    const stopping = other.loop.stop("ses_parent")
    await vi.advanceTimersByTimeAsync(0)
    let closed = false
    const closing = first.loop.close().then(() => { closed = true })
    try {
      await vi.advanceTimersByTimeAsync(0)
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

    await vi.advanceTimersByTimeAsync(20 * MINUTE)

    expect(admit).toHaveBeenCalledOnce()
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

    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(admit).toHaveBeenCalledOnce()
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
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(first.wake).toHaveBeenCalledOnce()

    let stopped = false
    const stopping = other.loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(stopped).toBe(false)
    } finally {
      waking.resolve()
      await stopping
    }

    expect(first.pending).toHaveLength(0)
    expect(first.saved.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("continues coordinating after more than two hours", async () => {
    const { loop, admit, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    for (let interval = 0; interval < 13; interval++) {
      await vi.advanceTimersByTimeAsync(10 * MINUTE)
      pending.splice(0)
    }

    expect(admit).toHaveBeenCalledTimes(13)
  })

  it("keeps another orchestrator's loop running when one session is stopped", async () => {
    const { loop, admit } = setup()
    await loop.start("ses_a", { objective: "First project" })
    await loop.start("ses_b", { objective: "Second project" })
    await loop.stop("ses_a")

    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(admit).toHaveBeenCalledOnce()
    expect(admit.mock.calls[0][0].sessionID).toBe("ses_b")
  })

  it("serializes concurrent updates to the same session", async () => {
    const { loop, admit, saved } = setup()
    await Promise.all([
      loop.start("ses_parent", { objective: "First request", intervalMinutes: 2 }),
      loop.start("ses_parent", { objective: "Second request", intervalMinutes: 3 }),
    ])

    await vi.advanceTimersByTimeAsync(3 * MINUTE)

    expect(admit).toHaveBeenCalledOnce()
    expect(saved.get("orchestrator-loop/ses_parent")).toMatchObject({ objective: "Second request", intervalMinutes: 3 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it("serializes a cross-location stop behind an activation being persisted", async () => {
    const first = setup()
    const other = setup("/other-project", first.saved, first.pending)
    const persistence = deferred<void>()
    const save = first.storage.set
    const implementation = vi.mocked(save).getMockImplementation()!
    vi.mocked(save).mockImplementationOnce(async (key, value) => {
      await persistence.promise
      await implementation(key, value)
    })
    const starting = first.loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledOnce()

    let stopped = false
    const stopping = other.loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(stopped).toBe(false)
    } finally {
      persistence.resolve()
      await Promise.all([starting, stopping])
    }
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

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
      await vi.advanceTimersByTimeAsync(10 * MINUTE)
      expect(first.admit).toHaveBeenCalledOnce()
      expect(restored.synthetic).not.toHaveBeenCalled()
    } finally {
      releaseAdmission()
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(first.pending).toHaveLength(1)
  })

  it.each(["SessionNotFoundError", "Session.NotFoundError"])("removes durable state when the target session reports %s", async (_tag) => {
    const { loop, get, saved, synthetic } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    get.mockRejectedValue({ _tag, sessionID: "ses_parent" })

    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(saved.size).toBe(0)
    expect(synthetic).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("pauses reminders while another agent is selected in the session", async () => {
    const { loop, get, admit } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    get.mockResolvedValueOnce({ agent: "plan" })

    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(admit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(admit).toHaveBeenCalledOnce()
  })

  it("pauses admission when the agent switches during the inbox lookup", async () => {
    const { loop, get, inbox, synthetic, wake } = setup()
    const inspection = deferred<PendingInputs>()
    await loop.start("ses_parent", { objective: "Finish the port" })
    inbox.list.mockReturnValueOnce(inspection.promise)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    inspection.resolve([])
    await vi.advanceTimersByTimeAsync(0)

    expect(synthetic).not.toHaveBeenCalled()
    expect(wake).not.toHaveBeenCalled()
  })

  it("does not wake an existing reminder after an agent switch during inbox lookup", async () => {
    const { loop, get, inbox, wake, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    wake.mockClear()
    const inspection = deferred<PendingInputs>()
    inbox.list.mockReturnValueOnce(inspection.promise)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    inspection.resolve([...pending])
    await vi.advanceTimersByTimeAsync(0)

    expect(wake).not.toHaveBeenCalled()
  })

  it("cancels a reminder admitted during an agent switch without waking the new agent", async () => {
    const { loop, get, admit, wake, pending } = setup()
    const releaseAdmission = holdNextAdmission(admit)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    releaseAdmission()
    await vi.advanceTimersByTimeAsync(0)

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
    vi.mocked(storage.set).mockRejectedValueOnce(new Error("Storage unavailable"))

    await expect(loop.start("ses_parent", { objective: "Finish the port" })).rejects.toThrow("Storage unavailable")

    expect(vi.getTimerCount()).toBe(0)
  })
})
