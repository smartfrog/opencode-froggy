import { describe, expect, it, jest, mock, type Mock } from "bun:test"
import { collectSessionContext } from "./session-context-report"
import { type SessionContextClient } from "./session-context-api"
import { type SessionSummary } from "./session-context"

const mocked = <T extends (...args: any[]) => any>(fn: T) => fn as unknown as Mock<T>

const tokens = { input: 1000, output: 200, cacheRead: 3000 }
const main: SessionSummary = {
  id: "ses_main",
  parentID: null,
  title: "Main session",
  agent: "plan",
  model: "deepseek/deepseek-flash#high",
  modelKey: "deepseek/deepseek-flash",
  cost: 1.25,
  tokens,
}
const child: SessionSummary = {
  id: "ses_child",
  parentID: "ses_main",
  title: "Curation",
  agent: "memory-manager",
  model: "deepseek/deepseek-flash#high",
  modelKey: "deepseek/deepseek-flash",
  cost: 2.5,
  tokens,
}
const messages = [
  { type: "user", text: "hello" },
  {
    type: "assistant",
    content: [{ type: "text", text: "ok" }],
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 900, write: 0 } },
  },
]

function setup(sessions: SessionSummary[] = [main, child]) {
  const client: SessionContextClient = {
    listSessions: mock(async () => sessions),
    getContext: mock(async () => messages),
    getSession: mock(async (id: string) => ({ id, created: 1 })),
    listModelLimits: mock(async () => new Map([["deepseek/deepseek-flash", 10_000]])),
  }
  return { client, report: collectSessionContext(client, "project-1", 10, "/repo") }
}

describe("session context report", () => {
  it("collects main and subagent rows with model limits", async () => {
    const { client, report } = setup()

    const result = await report

    expect(client.listSessions).toHaveBeenCalledWith("project-1", 10)
    expect(client.listModelLimits).toHaveBeenCalledWith("/repo")
    expect(result.limitError).toBeNull()
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].analysis).toMatchObject({ promptTokens: 1000, contextLimit: 10_000, usedPercent: 10 })
    expect(result.rows[1].session.parentID).toBe("ses_main")
    expect(result.rows[1].session.agent).toBe("memory-manager")
  })

  it("reports an empty project without fetching models", async () => {
    const { client, report } = setup([])

    const result = await report

    expect(result).toEqual({ rows: [], limitError: null })
    expect(client.listModelLimits).not.toHaveBeenCalled()
  })

  it("isolates a context failure to its session", async () => {
    const { client, report } = setup()
    mocked(client.getContext).mockImplementation(async (id) => {
      if (id === child.id) throw new Error("context unavailable")
      return messages
    })

    const result = await report

    expect(result.rows[0].error).toBeNull()
    expect(result.rows[1]).toMatchObject({ analysis: null, error: "context unavailable" })
  })

  it("keeps rows when model limits are unavailable", async () => {
    const { client, report } = setup([main])
    mocked(client.listModelLimits).mockRejectedValue(new Error("model offline"))

    const result = await report

    expect(result.limitError).toBe("model offline")
    expect(result.rows[0].analysis).toMatchObject({ contextLimit: null, usedPercent: null })
  })
})
