import { describe, expect, it, jest, mock } from "bun:test"
import { createSessionContextTool } from "./session-context"
import { type SessionContextClient } from "../session-context-api"
import { type SessionSummary } from "../session-context"

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
  { type: "user", text: "RAW_SECRET_MARKER" },
  {
    type: "assistant",
    content: [{ type: "text", text: "ok" }],
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 900, write: 0 } },
  },
]

function setup() {
  const client: SessionContextClient = {
    listSessions: mock(async () => [main, child]),
    getContext: mock(async () => messages),
    getSession: mock(async (id: string) => ({ id, created: 1 })),
    listModelLimits: mock(async () => new Map([["deepseek/deepseek-flash", 10_000]])),
  }
  return { client, tool: createSessionContextTool("project-1", "/repo", { client }) }
}

describe("session-context tool", () => {
  it("returns only the aggregated report, never raw messages", async () => {
    const { client, tool } = setup()

    const result = await tool.execute({})

    expect(client.listSessions).toHaveBeenCalledWith("project-1", 10)
    expect(result.content).toContain("### Session context — 2 most recent sessions")
    expect(result.content).toContain("| # | Session | Agent · Model | Context / Limit (used) | Top tool | Cost | Cumul session (in/out/cache) |")
    expect(result.content).toContain("| # | Agent (kind) | Cost | reasoning | tool calls | tool results | system | compaction | assistant | user | other |")
    expect(result.content).toContain("### Categories")
    expect(result.content).toContain("memory-manager")
    expect(result.content).toContain("10.0%")
    expect(result.content).toContain("| **Global** | **all sessions** | **$3.75** |")
    expect(result.content).not.toContain("RAW_SECRET_MARKER")
  })

  it("verifies the invoking session against the host service", async () => {
    const { client } = setup()
    const verifySession = mock(async () => {})
    const tool = createSessionContextTool("project-1", "/repo", { client, verifySession })

    await tool.execute({}, { sessionID: "ses_main" })

    expect(verifySession).toHaveBeenCalledWith("ses_main")
  })

  it("honors an explicit limit", async () => {
    const { client, tool } = setup()

    await tool.execute({ limit: 1 })

    expect(client.listSessions).toHaveBeenCalledWith("project-1", 1)
  })

  it.each([0, 51, 1.5])("rejects invalid limit %s", async (limit) => {
    const { tool } = setup()

    await expect(tool.execute({ limit })).rejects.toThrow("between 1 and 50")
  })
})
