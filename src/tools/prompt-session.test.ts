import { describe, it, expect, vi } from "vitest"
import { createPromptSessionTool } from "./prompt-session"
import { ChildSessionTracker } from "../session-children"

interface SyntheticInput {
  sessionID: string
  text: string
  description?: string
  delivery?: string
  metadata?: Record<string, unknown>
}

function setup(options?: { pollIntervalMs?: number; maxWatchMs?: number }) {
  const tracker = new ChildSessionTracker()
  const prompt = vi.fn(async (_input: { sessionID: string; text: string; delivery?: string }) => ({}))
  const get = vi.fn(async (_input: { sessionID: string }) => ({}))
  const context = vi.fn(async (_input: { sessionID: string }) => [] as unknown[])
  const synthetic = vi.fn(async (_input: SyntheticInput) => {})
  const tool = createPromptSessionTool(
    { prompt, get, context, synthetic },
    tracker,
    { pollIntervalMs: options?.pollIntervalMs ?? 1, maxWatchMs: options?.maxWatchMs },
  )
  return { tracker, prompt, get, context, synthetic, tool }
}

const assistant = (text: string) => ({ type: "assistant", content: [{ type: "text", text }] })

describe("createPromptSessionTool", () => {
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
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(get).not.toHaveBeenCalled()
    expect(context).not.toHaveBeenCalled()
    expect(synthetic).not.toHaveBeenCalled()
  })

  it("should poll until our turn completed, then notify the parent with the report", async () => {
    const { tracker, prompt, get, context, synthetic, tool } = setup()
    const before = Date.now()
    tracker.trackChild({ id: "ses_child", parentID: "ses_parent", created: 1, updated: 1 })
    get
      .mockResolvedValueOnce({ time: { idle: before - 1000 }, title: "Child" })
      .mockResolvedValueOnce({ time: { idle: before + 1000 }, title: "Child" })
      .mockResolvedValueOnce({ time: { idle: before + 1000 }, title: "Child" })
    context
      .mockResolvedValueOnce([
        { type: "idle", outcome: "succeeded" },
        { type: "user", time: { created: before + 500 } },
      ])
      .mockResolvedValueOnce([
        { type: "user", time: { created: before + 500 } },
        assistant("the report"),
        { type: "idle", outcome: "succeeded" },
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
      { type: "idle", outcome: "succeeded" },
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
      { type: "idle", outcome: "succeeded" },
      { id: "msg_2", type: "user", time: { created: before + 600 } },
      assistant("turn two report"),
      { type: "idle", outcome: "succeeded" },
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
      { type: "idle", outcome: "succeeded" },
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
      { type: "idle", outcome: "failed" },
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
})
