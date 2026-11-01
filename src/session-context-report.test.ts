import { describe, expect, it, mock } from "bun:test"
import { collectSessionContext } from "./session-context-report"
import { type SessionContextClient } from "./session-context-api"
import { type SessionSummary } from "./session-context"
import { CHILD_SESSION, CONTEXT_MESSAGES, SESSION_SUMMARIES } from "./test-fixtures/session-context"

function setup(sessions: SessionSummary[] = SESSION_SUMMARIES) {
  return {
    listSessions: mock(async () => sessions),
    getContext: mock(async (_sessionID: string) => CONTEXT_MESSAGES),
    listModelLimits: mock(async () => new Map([["deepseek/deepseek-flash", 10_000]])),
  } satisfies SessionContextClient
}

describe("session context report", () => {
  it("collects main and subagent rows with model limits", async () => {
    const client = setup()

    const result = await collectSessionContext(client, "project-1", 10, "/repo")

    expect(client.listSessions).toHaveBeenCalledWith("project-1", 10)
    expect(client.listModelLimits).toHaveBeenCalledWith("/repo")
    expect(result.limitError).toBeNull()
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].analysis).toMatchObject({ promptTokens: 1000, contextLimit: 10_000, usedPercent: 10 })
    expect(result.rows[1].session.parentID).toBe("ses_main")
    expect(result.rows[1].session.agent).toBe("memory-manager")
  })

  it("reports an empty project without fetching models", async () => {
    const client = setup([])

    const result = await collectSessionContext(client, "project-1", 10, "/repo")

    expect(result).toEqual({ rows: [], limitError: null })
    expect(client.listModelLimits).not.toHaveBeenCalled()
  })

  it("isolates a context failure to its session", async () => {
    const client = setup()
    client.getContext.mockImplementation(async (id) => {
      if (id === CHILD_SESSION.id) throw new Error("context unavailable")
      return CONTEXT_MESSAGES
    })

    const result = await collectSessionContext(client, "project-1", 10, "/repo")

    expect(result.rows[0].error).toBeNull()
    expect(result.rows[1]).toMatchObject({ analysis: null, error: "context unavailable" })
  })

  it("keeps rows when model limits are unavailable", async () => {
    const client = setup(SESSION_SUMMARIES.slice(0, 1))
    client.listModelLimits.mockRejectedValue(new Error("model offline"))

    const result = await collectSessionContext(client, "project-1", 10, "/repo")

    expect(result.limitError).toBe("model offline")
    expect(result.rows[0].analysis).toMatchObject({ contextLimit: null, usedPercent: null })
  })
})
