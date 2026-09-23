import { describe, it, expect } from "vitest"
import { renderSubagentCompletion, resolveChildTurn } from "./child-completion"

const user = (created: number, id?: string) => ({
  ...(id ? { id } : {}),
  type: "user",
  time: { created },
})

const assistant = (text: string) => ({
  type: "assistant",
  content: [{ type: "reasoning", text: "thinking" }, { type: "text", text }],
})

const idle = (outcome?: string) => ({
  type: "idle",
  ...(outcome ? { outcome } : {}),
})

describe("resolveChildTurn", () => {
  const since = 1000

  it("should return null when no user message was sent since the prompt", () => {
    const messages = [user(500), idle("succeeded")]
    expect(resolveChildTurn(messages, since)).toBeNull()
  })

  it("should return null when the message is still queued behind a running turn", () => {
    const messages = [assistant("running"), idle("succeeded"), user(1200), assistant("working")]
    expect(resolveChildTurn(messages, since)).toBeNull()
  })

  it("should resolve our turn only when a later turn already started after ours completed", () => {
    const messages = [
      user(1200),
      assistant("first report"),
      idle("succeeded"),
      user(1500),
      assistant("second turn in flight"),
    ]
    expect(resolveChildTurn(messages, since)).toEqual({ state: "completed", text: "first report" })
  })

  it("should return the last assistant text of our turn", () => {
    const messages = [user(1200), assistant("first"), assistant("final report"), idle("succeeded")]
    expect(resolveChildTurn(messages, since)).toEqual({ state: "completed", text: "final report" })
  })

  it("should return error state for a failed idle outcome", () => {
    const messages = [user(1200), assistant("partial"), idle("failed")]
    expect(resolveChildTurn(messages, since)).toEqual({ state: "error", text: "partial" })
  })

  it("should return error state for an interrupted idle outcome", () => {
    const messages = [user(1200), idle("interrupted")]
    expect(resolveChildTurn(messages, since)).toEqual({ state: "error", text: "" })
  })

  it("should return empty text when the last assistant message has no text part", () => {
    const messages = [
      user(1200),
      assistant("old"),
      { type: "assistant", content: [{ type: "reasoning", text: "hmm" }] },
      idle("succeeded"),
    ]
    expect(resolveChildTurn(messages, since)).toEqual({ state: "completed", text: "" })
  })

  it("should anchor on the exact message id when provided", () => {
    const messages = [
      user(100, "msg_1"),
      assistant("turn one"),
      idle("succeeded"),
      user(200, "msg_2"),
      assistant("turn two"),
      idle("succeeded"),
    ]
    expect(resolveChildTurn(messages, 50, "msg_2")).toEqual({ state: "completed", text: "turn two" })
  })

  it("should fall back to the timestamp anchor when the message id is not found", () => {
    const messages = [
      user(100, "msg_1"),
      assistant("turn one"),
      idle("succeeded"),
      user(200, "msg_2"),
      assistant("turn two"),
      idle("succeeded"),
    ]
    expect(resolveChildTurn(messages, 50, "msg_missing")).toEqual({ state: "completed", text: "turn one" })
  })

  it("should handle malformed input", () => {
    expect(resolveChildTurn(null, since)).toBeNull()
    expect(resolveChildTurn("nope", since)).toBeNull()
    expect(resolveChildTurn([null, 42, { type: "assistant" }], since)).toBeNull()
  })
})

describe("renderSubagentCompletion", () => {
  it("should render a core-compatible completed subagent tag", () => {
    expect(
      renderSubagentCompletion({
        sessionID: "ses_child",
        state: "completed",
        description: "Fix the bug",
        text: "all done",
      }),
    ).toBe('<subagent sessionID="ses_child" state="completed" description="Fix the bug">\nall done\n</subagent>')
  })

  it("should omit the description attribute when absent", () => {
    expect(renderSubagentCompletion({ sessionID: "ses_child", state: "error", text: "boom" })).toBe(
      '<subagent sessionID="ses_child" state="error">\nboom\n</subagent>',
    )
  })

  it("should escape quotes and ampersands in the description attribute", () => {
    expect(
      renderSubagentCompletion({
        sessionID: "ses_child",
        state: "error",
        description: 'Fix "> injection & crash',
        text: "boom",
      }),
    ).toBe('<subagent sessionID="ses_child" state="error" description="Fix &quot;> injection &amp; crash">\nboom\n</subagent>')
  })
})
