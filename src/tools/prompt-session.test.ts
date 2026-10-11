import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createPromptSessionTool } from "./prompt-session"
import { ChildSessionTracker } from "../session-children"

interface SyntheticInput {
  sessionID: string
  text: string
  description?: string
  delivery?: string
  metadata?: Record<string, unknown>
}

const controllers: AbortController[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function setup(options?: { pollIntervalMs?: number; maxWatchMs?: number }) {
  const controller = new AbortController()
  controllers.push(controller)
  const tracker = new ChildSessionTracker()
  const prompt = vi.fn(async (_input: { sessionID: string; text: string; delivery?: string }) => ({}))
  const get = vi.fn(async (_input: { sessionID: string }) => ({}))
  const context = vi.fn(async (_input: { sessionID: string }) => [] as unknown[])
  const synthetic = vi.fn(async (_input: SyntheticInput) => {})
  const tool = createPromptSessionTool(
    { prompt, get, context, synthetic },
    tracker,
    { pollIntervalMs: options?.pollIntervalMs ?? 1, maxWatchMs: options?.maxWatchMs, signal: controller.signal },
  )
  return { tracker, prompt, get, context, synthetic, tool, controller }
}

const assistant = (text: string) => ({ type: "assistant", content: [{ type: "text", text }] })
const idle = (id = "msg_done", outcome = "succeeded") => ({ id, type: "idle", outcome })

describe("createPromptSessionTool", () => {
  beforeEach(() => vi.useFakeTimers())

  afterEach(async () => {
    for (const controller of controllers.splice(0)) controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("should return an error when no child session exists", async () => {
    const { tool } = setup()
    const result = await tool.execute({ message: "hello" }, { sessionID: "ses_parent" })
    expect(result).toEqual({ content: "Error: No child session found for current session" })
  })

  it("should send the message to the explicit sessionId with queue delivery", async () => {
    const { tracker, prompt, tool } = setup()
    tracker.trackChild({ id: "ses_other", parentID: "ses_parent", created: 1, updated: 1 })
    await tool.execute({ message: "apply the fixes", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    expect(prompt).toHaveBeenCalledWith({ sessionID: "ses_child", text: "apply the fixes", delivery: "queue" })
  })

  it("should fall back to the last child when sessionId is omitted", async () => {
    const { tracker, prompt, tool } = setup()
    tracker.trackChild({ id: "ses_first", parentID: "ses_parent", created: 1, updated: 1 })
    tracker.trackChild({ id: "ses_last", parentID: "ses_parent", created: 2, updated: 2 })
    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    expect(prompt).toHaveBeenCalledWith({ sessionID: "ses_last", text: "continue", delivery: "queue" })
  })

  it("should not notify when the prompt fails", async () => {
    const { tracker, prompt, get, context, synthetic, tool } = setup()
    prompt.mockRejectedValueOnce(new Error("prompt rejected"))
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })

    await expect(tool.execute({ message: "continue" }, { sessionID: "ses_parent" })).rejects.toThrow(
      "prompt rejected",
    )
    await vi.advanceTimersByTimeAsync(30)
    expect(get).not.toHaveBeenCalled()
    expect(context).not.toHaveBeenCalled()
    expect(synthetic).not.toHaveBeenCalled()
  })

  it("should poll until our turn completed, then notify the parent with the report", async () => {
    const { tracker, get, context, synthetic, tool } = setup()
    const before = Date.now()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    get
      .mockResolvedValueOnce({ time: { idle: before - 1000 }, title: "Child" })
      .mockResolvedValueOnce({ time: { idle: before + 1000 }, title: "Child" })
      .mockResolvedValueOnce({ time: { idle: before + 1000 }, title: "Child" })
    context
      .mockResolvedValueOnce([
        idle("msg_previous"),
        { type: "user", time: { created: before + 500 } },
      ])
      .mockResolvedValueOnce([
        { type: "user", time: { created: before + 500 } },
        assistant("the report"),
        idle(),
      ])

    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    await vi.waitFor(() => expect(synthetic).toHaveBeenCalledTimes(1))

    expect(synthetic).toHaveBeenCalledWith({
      sessionID: "ses_parent",
      text: '<subagent sessionID="ses_child" state="completed" description="Child">\nthe report\n</subagent>',
      description: "Child",
      delivery: "queue",
      metadata: { source: "subagent", childID: "ses_child", state: "completed" },
    })
  })

  it("should report our turn only when a later turn is already in flight", async () => {
    const { tracker, get, context, synthetic, tool } = setup()
    const before = Date.now()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    get.mockResolvedValue({ time: { idle: before + 1000 }, title: "Child" })
    context.mockResolvedValue([
      { type: "user", time: { created: before + 500 } },
      assistant("turn one report"),
      idle(),
      { type: "user", time: { created: before + 600 } },
      assistant("turn two in flight"),
    ])

    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    await vi.waitFor(() => expect(synthetic).toHaveBeenCalledTimes(1))
    expect(synthetic.mock.calls[0][0].text).toContain("turn one report")
    expect(synthetic.mock.calls[0][0].text).not.toContain("turn two in flight")
  })

  it("should anchor on the message id returned by prompt when multiple turns are queued", async () => {
    const { tracker, prompt, get, context, synthetic, tool } = setup()
    const before = Date.now()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    prompt.mockResolvedValue({ id: "msg_2" })
    get.mockResolvedValue({ time: { idle: before + 1000 }, title: "Child" })
    context.mockResolvedValue([
      { id: "msg_1", type: "user", time: { created: before + 500 } },
      assistant("turn one report"),
      idle("msg_done_1"),
      { id: "msg_2", type: "user", time: { created: before + 600 } },
      assistant("turn two report"),
      idle("msg_done_2"),
    ])

    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    await vi.waitFor(() => expect(synthetic).toHaveBeenCalledTimes(1))
    expect(synthetic.mock.calls[0][0].text).toContain("turn two report")
    expect(synthetic.mock.calls[0][0].text).not.toContain("turn one report")
  })

  it("should keep watching after a transient polling failure", async () => {
    const { tracker, get, context, synthetic, tool } = setup()
    const before = Date.now()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    get
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ time: { idle: before + 1000 }, title: "Child" })
    context.mockResolvedValue([
      { type: "user", time: { created: before + 500 } },
      assistant("the report"),
      idle(),
    ])

    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    await vi.waitFor(() => expect(synthetic).toHaveBeenCalledTimes(1))
    expect(synthetic.mock.calls[0][0].text).toContain("the report")
  })

  it("should render an error state when the child turn failed", async () => {
    const { tracker, get, context, synthetic, tool } = setup()
    const before = Date.now()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    get.mockResolvedValue({ time: { idle: before + 1000 } })
    context.mockResolvedValue([
      { type: "user", time: { created: before + 500 } },
      assistant("partial"),
      idle("msg_done", "failed"),
    ])

    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    await vi.waitFor(() => expect(synthetic).toHaveBeenCalledTimes(1))
    expect(synthetic.mock.calls[0][0].text).toContain('state="error"')
    expect(synthetic.mock.calls[0][0].metadata).toEqual({
      source: "subagent",
      childID: "ses_child",
      state: "error",
    })
  })

  it("should stop watching and notify abandonment when the child session disappears", async () => {
    const { tracker, get, context, synthetic, tool } = setup()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    get.mockRejectedValue(new Error("session not found"))

    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    await vi.waitFor(() => expect(synthetic).toHaveBeenCalledTimes(1))
    expect(context).not.toHaveBeenCalled()
    expect(synthetic.mock.calls[0][0].text).toContain("Completion watch abandoned")
    expect(synthetic.mock.calls[0][0].text).toContain("polling failed")
    expect(synthetic.mock.calls[0][0].metadata).toEqual({
      source: "subagent",
      childID: "ses_child",
      state: "error",
    })
  })

  it("should notify abandonment when the watch exceeds the max duration", async () => {
    const { tracker, get, context, synthetic, tool } = setup({ pollIntervalMs: 1, maxWatchMs: 5 })
    const before = Date.now()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    get.mockResolvedValue({ time: { idle: before - 1000 }, title: "Child" })

    await tool.execute({ message: "continue" }, { sessionID: "ses_parent" })
    await vi.waitFor(() => expect(synthetic).toHaveBeenCalledTimes(1))
    expect(context).not.toHaveBeenCalled()
    expect(synthetic.mock.calls[0][0].text).toContain("Completion watch abandoned")
    expect(synthetic.mock.calls[0][0].text).toContain("did not complete within")
  })

  it("should share one watch and notification for messages completed together", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    prompt
      .mockResolvedValueOnce({ id: "msg_1" })
      .mockResolvedValueOnce({ id: "msg_2" })
      .mockResolvedValueOnce({ id: "msg_3" })
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([
      { id: "msg_1", type: "user" },
      { id: "msg_2", type: "user" },
      { id: "msg_3", type: "user" },
      assistant("one final report"),
      idle(),
    ])

    await Promise.all(["first", "second", "third"].map((message) =>
      tool.execute({ message, sessionId: "ses_child" }, { sessionID: "ses_parent" }),
    ))
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).toHaveBeenCalledTimes(1)
    expect(synthetic.mock.calls[0][0].text).toContain("one final report")
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("should notify for distinct completed turns even when their reports are identical", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    prompt.mockResolvedValueOnce({ id: "msg_1" }).mockResolvedValueOnce({ id: "msg_2" })
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([
      { id: "msg_1", type: "user" },
      assistant("done"),
      idle("msg_done_1"),
      { id: "msg_2", type: "user" },
      assistant("done"),
      idle("msg_done_2"),
    ])

    await tool.execute({ message: "first", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await tool.execute({ message: "second", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).toHaveBeenCalledTimes(2)
  })

  it("should notify a later execution after the previous watch has finished", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    prompt.mockResolvedValueOnce({ id: "msg_1" }).mockResolvedValueOnce({ id: "msg_2" })
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    const firstTurn = [{ id: "msg_1", type: "user" }, assistant("done"), idle("msg_done_1")]
    context.mockResolvedValue(firstTurn)

    await tool.execute({ message: "first", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(10)
    context.mockResolvedValue([
      ...firstTurn,
      { id: "msg_2", type: "user" },
      assistant("done"),
      idle("msg_done_2"),
    ])
    await tool.execute({ message: "second", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).toHaveBeenCalledTimes(2)
  })

  it("should not repeat a completion when another prompt admission returns late", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    const secondAdmission = deferred<{ id: string }>()
    prompt.mockResolvedValueOnce({ id: "msg_1" }).mockReturnValueOnce(secondAdmission.promise)
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([
      { id: "msg_1", type: "user" },
      { id: "msg_2", type: "user" },
      assistant("one final report"),
      idle(),
    ])

    await tool.execute({ message: "first", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    const second = tool.execute({ message: "second", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(10)
    expect(prompt).toHaveBeenCalledTimes(2)
    secondAdmission.resolve({ id: "msg_2" })
    await second
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).toHaveBeenCalledTimes(1)
  })

  it("should preserve completed turns when a late admission replaces a failed watch", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    const secondAdmission = deferred<{ id: string }>()
    prompt
      .mockResolvedValueOnce({ id: "msg_1" })
      .mockReturnValueOnce(secondAdmission.promise)
      .mockResolvedValueOnce({ id: "msg_3" })
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([
      { id: "msg_1", type: "user" },
      { id: "msg_2", type: "user" },
      assistant("shared report"),
      idle("msg_done_1"),
      { id: "msg_3", type: "user" },
    ])

    await tool.execute({ message: "first", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    const second = tool.execute({ message: "second", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await tool.execute({ message: "third", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(1)
    expect(synthetic).toHaveBeenCalledTimes(1)

    get.mockRejectedValue(new Error("disconnected"))
    await vi.advanceTimersByTimeAsync(3)
    expect(synthetic.mock.calls[1][0].text).toContain("Completion watch abandoned")

    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    expect(prompt).toHaveBeenCalledTimes(3)
    secondAdmission.resolve({ id: "msg_2" })
    await second
    await vi.advanceTimersByTimeAsync(10)

    const completions = synthetic.mock.calls.filter(([notification]) => notification.metadata?.state === "completed")
    expect(completions).toHaveLength(1)
    expect(completions[0][0].text).toContain("shared report")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("should wait for the exact prompt instead of reporting an earlier queued turn", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    prompt.mockResolvedValue({ id: "msg_queued" })
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([
      { id: "msg_other", type: "user", time: { created: Date.now() } },
      assistant("another turn's report"),
      idle(),
    ])

    await tool.execute({ message: "continue", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).not.toHaveBeenCalled()
  })

  it("should watch a new prompt admitted while an abandonment notification is in flight", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    const abandonment = deferred<void>()
    prompt.mockResolvedValueOnce({ id: "msg_1" }).mockResolvedValueOnce({ id: "msg_2" })
    get.mockRejectedValue(new Error("unavailable"))
    synthetic.mockReturnValueOnce(abandonment.promise)
    await tool.execute({ message: "first", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(3)

    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([{ id: "msg_2", type: "user" }, assistant("recovered"), idle()])
    await tool.execute({ message: "retry", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    expect(synthetic).toHaveBeenCalledTimes(1)
    abandonment.resolve()
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).toHaveBeenCalledTimes(2)
    expect(synthetic.mock.calls[1][0].text).toContain("recovered")
  })

  it("should give a later prompt its own timeout budget", async () => {
    const { prompt, get, context, synthetic, tool } = setup({ maxWatchMs: 10 })
    prompt.mockResolvedValueOnce({ id: "msg_1" }).mockResolvedValueOnce({ id: "msg_2" })
    await tool.execute({ message: "first", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(8)
    await tool.execute({ message: "second", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(2)

    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([{ id: "msg_2", type: "user" }, assistant("second report"), idle()])
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).toHaveBeenCalledTimes(2)
    expect(synthetic.mock.calls[0][0].text).toContain("Completion watch abandoned")
    expect(synthetic.mock.calls[1][0].text).toContain("second report")
  })

  it("should notify each parent independently for a shared child completion", async () => {
    const { prompt, get, context, synthetic, tool } = setup()
    prompt.mockResolvedValueOnce({ id: "msg_1" }).mockResolvedValueOnce({ id: "msg_2" })
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockResolvedValue([
      { id: "msg_1", type: "user" },
      { id: "msg_2", type: "user" },
      assistant("shared report"),
      idle(),
    ])

    await tool.execute({ message: "first", sessionId: "ses_child" }, { sessionID: "ses_parent_1" })
    await tool.execute({ message: "second", sessionId: "ses_child" }, { sessionID: "ses_parent_2" })
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic.mock.calls.map(([notification]) => notification.sessionID)).toEqual([
      "ses_parent_1", "ses_parent_2",
    ])
  })

  it("should stop polling when the plugin unloads", async () => {
    const { get, synthetic, tool, controller } = setup()
    await tool.execute({ message: "continue", sessionId: "ses_child" }, { sessionID: "ses_parent" })

    controller.abort()
    await vi.advanceTimersByTimeAsync(10)

    expect(get).not.toHaveBeenCalled()
    expect(synthetic).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("should discard an in-flight context read after the plugin unloads", async () => {
    const { prompt, get, context, synthetic, tool, controller } = setup()
    const contextRead = deferred<unknown[]>()
    prompt.mockResolvedValue({ id: "msg_1" })
    get.mockResolvedValue({ time: { idle: Date.now() + 1000 } })
    context.mockReturnValue(contextRead.promise)
    await tool.execute({ message: "continue", sessionId: "ses_child" }, { sessionID: "ses_parent" })
    await vi.advanceTimersByTimeAsync(1)

    controller.abort()
    expect(context).toHaveBeenCalledTimes(1)
    contextRead.resolve([{ id: "msg_1", type: "user" }, assistant("done"), idle()])
    await vi.advanceTimersByTimeAsync(10)

    expect(synthetic).not.toHaveBeenCalled()
  })

  it("should not start a watch for an admission that returns after the plugin unloads", async () => {
    const { prompt, get, synthetic, tool, controller } = setup()
    const admission = deferred<{ id: string }>()
    prompt.mockReturnValue(admission.promise)
    const execution = tool.execute({ message: "continue", sessionId: "ses_child" }, { sessionID: "ses_parent" })

    controller.abort()
    expect(prompt).toHaveBeenCalledTimes(1)
    admission.resolve({ id: "msg_1" })
    await expect(execution).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10)

    expect(get).not.toHaveBeenCalled()
    expect(synthetic).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
