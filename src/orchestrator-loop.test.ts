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

function holdNextAdmission(synthetic: ReturnType<typeof setup>["synthetic"]) {
  const admission = deferred<void>()
  const send = synthetic.getMockImplementation()!
  synthetic.mockImplementationOnce(async (input) => {
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
  let messageCount = 0
  const synthetic = vi.fn<LoopSessionClient["synthetic"]>(async (input) => {
    const item = {
      id: `msg_${++messageCount}`,
      sessionID: input.sessionID,
      type: "synthetic",
      payload: { metadata: input.metadata },
    }
    pending.push(item)
    return { id: item.id }
  })
  const inbox = {
    list: vi.fn(async ({ sessionID }: { sessionID: string }) => pending.filter((item) => !item.sessionID || item.sessionID === sessionID)),
    cancel: vi.fn(async ({ inboxID }: { sessionID: string; inboxID: string }) => {
      const index = pending.findIndex((item) => item.id === inboxID)
      if (index !== -1) pending.splice(index, 1)
    }),
    update: vi.fn(async () => {}),
  }
  const activity = vi.fn(async () => "ses_child: inactive, 1 running shell")
  const loop = createLoop({ directory, storage, session: { get, synthetic, inbox }, activity })
  loops.push(loop)
  return { loop, saved, storage, get, synthetic, inbox, pending, activity }
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
    const { loop, synthetic, pending } = setup()
    const { startTool, stopTool } = createOrchestratorLoopTools(loop)
    await startTool.execute({ objective: "Finish the port", intervalMinutes: 1 }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(MINUTE)

    await stopTool.execute({}, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(MINUTE)

    expect(synthetic).toHaveBeenCalledOnce()
    expect(synthetic.mock.calls[0][0].sessionID).toBe("ses_parent")
    expect(pending).toHaveLength(0)
  })

  it("steers the current orchestrator after ten minutes with its objective and child activity", async () => {
    const { loop, synthetic, inbox } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    await vi.advanceTimersByTimeAsync(10 * MINUTE - 1)
    expect(synthetic).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(synthetic).toHaveBeenCalledOnce()
    expect(synthetic).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: "ses_parent",
      delivery: "steer",
      resume: false,
      text: expect.stringContaining("Finish the port"),
    }))
    expect(synthetic.mock.calls[0][0].text).toContain("ses_child: inactive, 1 running shell")
    expect(inbox.update).toHaveBeenCalledWith({ sessionID: "ses_parent", inboxID: "msg_1", delivery: "steer" })
  })

  it("keeps only one reminder pending while the orchestrator is busy", async () => {
    const { loop, synthetic } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    await vi.advanceTimersByTimeAsync(30 * MINUTE)

    expect(synthetic).toHaveBeenCalledOnce()
  })

  it("replaces the existing cadence and cancels its old pending reminder", async () => {
    const { loop, synthetic, pending } = setup()
    await loop.start("ses_parent", { objective: "First objective" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    await loop.start("ses_parent", { objective: "Revised objective", intervalMinutes: 2 })
    expect(pending).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2 * MINUTE)

    expect(synthetic).toHaveBeenCalledTimes(2)
    expect(synthetic.mock.calls[1][0].text).toContain("Revised objective")
    expect(vi.getTimerCount()).toBe(1)
  })

  it("stops reminders and cancels only this loop's pending input", async () => {
    const { loop, synthetic, pending } = setup()
    pending.push({ id: "msg_user", type: "user", payload: {} })
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    await loop.stop("ses_parent")
    await vi.advanceTimersByTimeAsync(30 * MINUTE)

    expect(synthetic).toHaveBeenCalledOnce()
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

    expect(restored.synthetic).toHaveBeenCalledOnce()
    expect(restored.synthetic.mock.calls[0][0].text).toContain("Finish the port")
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

    expect(first.synthetic).toHaveBeenCalledOnce()
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

    expect(restored.synthetic).not.toHaveBeenCalled()
    expect(restored.inbox.update).toHaveBeenCalledWith({ sessionID: "ses_parent", inboxID: "msg_1", delivery: "steer" })
  })

  it("reports an unavailable activity snapshot instead of assuming no work is running", async () => {
    const { loop, activity, synthetic } = setup()
    activity.mockRejectedValueOnce(new Error("Shell service unavailable"))
    await loop.start("ses_parent", { objective: "Finish the port" })

    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(synthetic).toHaveBeenCalledOnce()
    expect(synthetic.mock.calls[0][0].text).toContain("Activity snapshot unavailable")
    expect(synthetic.mock.calls[0][0].text).toContain("Shell service unavailable")
  })

  it("cancels a reminder whose admission finishes while stop is waiting", async () => {
    const { loop, synthetic, inbox, pending } = setup()
    const releaseAdmission = holdNextAdmission(synthetic)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(synthetic).toHaveBeenCalledOnce()

    const stopping = loop.stop("ses_parent")
    await vi.advanceTimersByTimeAsync(0)
    releaseAdmission()
    await stopping

    expect(inbox.update).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not send a late activity result after plugin cleanup", async () => {
    const { loop, activity, synthetic, saved } = setup()
    const inspection = deferred<string>()
    activity.mockReturnValueOnce(inspection.promise)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    const closing = loop.close()
    inspection.resolve("No active children")
    await closing

    expect(synthetic).not.toHaveBeenCalled()
    expect(saved.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("waits for a late admission when stop and plugin cleanup happen together", async () => {
    const { loop, synthetic, pending } = setup()
    const releaseAdmission = holdNextAdmission(synthetic)
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
    const inspection = deferred<string>()
    first.activity.mockReturnValueOnce(inspection.promise)
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    const other = setup("/other-project", first.saved)

    const stopping = other.loop.stop("ses_parent")
    await vi.advanceTimersByTimeAsync(0)
    inspection.resolve("No active children")
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
    const releaseAdmission = holdNextAdmission(first.synthetic)
    await first.loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(first.synthetic).toHaveBeenCalledOnce()

    let stopped = false
    const stopping = other.loop.stop("ses_parent").then(() => { stopped = true })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(stopped).toBe(false)
    } finally {
      releaseAdmission()
      await stopping
    }

    expect(first.inbox.update).not.toHaveBeenCalled()
    expect(first.pending).toHaveLength(0)
    expect(first.saved.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])("cancels a reminder when stopped during its final agent check (delayed removal: %s)", async (delayedRemoval) => {
    const first = setup()
    const other = setup("/other-project", first.saved, first.pending)
    const agentCheck = deferred<unknown>()
    const send = first.synthetic.getMockImplementation()!
    first.synthetic.mockImplementationOnce(async (input) => {
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

      expect(first.inbox.update).not.toHaveBeenCalled()
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
    const releaseAdmission = holdNextAdmission(first.synthetic)
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

    expect(first.inbox.update).not.toHaveBeenCalled()
    expect(first.pending).toHaveLength(0)
  })

  it("retries waking the existing durable reminder after a wake failure", async () => {
    const { loop, synthetic, inbox } = setup()
    inbox.update.mockRejectedValueOnce(new Error("Wake unavailable"))
    await loop.start("ses_parent", { objective: "Finish the port" })

    await vi.advanceTimersByTimeAsync(20 * MINUTE)

    expect(synthetic).toHaveBeenCalledOnce()
    expect(inbox.update).toHaveBeenCalledTimes(2)
  })

  it("continues coordinating after more than two hours", async () => {
    const { loop, synthetic, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })

    for (let interval = 0; interval < 13; interval++) {
      await vi.advanceTimersByTimeAsync(10 * MINUTE)
      pending.splice(0)
    }

    expect(synthetic).toHaveBeenCalledTimes(13)
  })

  it("keeps another orchestrator's loop running when one session is stopped", async () => {
    const { loop, synthetic } = setup()
    await loop.start("ses_a", { objective: "First project" })
    await loop.start("ses_b", { objective: "Second project" })
    await loop.stop("ses_a")

    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    expect(synthetic).toHaveBeenCalledOnce()
    expect(synthetic.mock.calls[0][0].sessionID).toBe("ses_b")
  })

  it("serializes concurrent updates to the same session", async () => {
    const { loop, synthetic } = setup()
    await Promise.all([
      loop.start("ses_parent", { objective: "First request", intervalMinutes: 2 }),
      loop.start("ses_parent", { objective: "Second request", intervalMinutes: 3 }),
    ])

    await vi.advanceTimersByTimeAsync(3 * MINUTE)

    expect(synthetic).toHaveBeenCalledOnce()
    expect(synthetic.mock.calls[0][0].text).toContain("Second request")
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
    const releaseAdmission = holdNextAdmission(first.synthetic)

    try {
      await vi.advanceTimersByTimeAsync(10 * MINUTE)
      expect(first.synthetic).toHaveBeenCalledOnce()
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
    const { loop, get, synthetic } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    get.mockResolvedValueOnce({ agent: "plan" })

    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(synthetic).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(synthetic).toHaveBeenCalledOnce()
  })

  it("pauses admission when the agent switches during the activity lookup", async () => {
    const { loop, get, activity, synthetic, inbox } = setup()
    const inspection = deferred<string>()
    activity.mockReturnValueOnce(inspection.promise)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    inspection.resolve("No active children")
    await vi.advanceTimersByTimeAsync(0)

    expect(synthetic).not.toHaveBeenCalled()
    expect(inbox.update).not.toHaveBeenCalled()
  })

  it("does not wake an existing reminder after an agent switch during inbox lookup", async () => {
    const { loop, get, inbox, pending } = setup()
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    inbox.update.mockClear()
    const inspection = deferred<PendingInputs>()
    inbox.list.mockReturnValueOnce(inspection.promise)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    inspection.resolve([...pending])
    await vi.advanceTimersByTimeAsync(0)

    expect(inbox.update).not.toHaveBeenCalled()
  })

  it("cancels a reminder admitted during an agent switch without waking the new agent", async () => {
    const { loop, get, synthetic, inbox, pending } = setup()
    const releaseAdmission = holdNextAdmission(synthetic)
    await loop.start("ses_parent", { objective: "Finish the port" })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)

    get.mockResolvedValue({ agent: "plan" })
    releaseAdmission()
    await vi.advanceTimersByTimeAsync(0)

    expect(inbox.update).not.toHaveBeenCalled()
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
