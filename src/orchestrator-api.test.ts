import { describe, expect, it, vi } from "vitest"
import { createOrchestratorClients, type OpenCodeRequest } from "./orchestrator-api"

function setup() {
  const native = {
    get: vi.fn(async () => ({ id: "ses_parent", time: { created: 123 } })),
    synthetic: vi.fn(async () => ({ id: "msg_reminder" })),
  }
  const request = vi.fn<OpenCodeRequest>()
  return { native, request, ...createOrchestratorClients(native, request) }
}

describe("orchestrator API bridge", () => {
  it("verifies the CLI is addressing the plugin's session before reading its pending reminders", async () => {
    const { session, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValueOnce({ data: [{ id: "msg_pending", type: "synthetic", payload: { metadata: { source: "test" } } }] })

    const items = await session.inbox.list({ sessionID: "ses_parent" })

    expect(request).toHaveBeenNthCalledWith(1, "get", "/api/session/ses_parent")
    expect(request).toHaveBeenNthCalledWith(2, "get", "/api/session/ses_parent/inbox")
    expect(items[0].id).toBe("msg_pending")
  })

  it("fails when the CLI points to a different session instead of treating the loop as deleted", async () => {
    const { session, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 999 } } })

    await expect(session.inbox.list({ sessionID: "ses_parent" })).rejects.toThrow("same OpenCode service")

    expect(request).toHaveBeenCalledOnce()
  })

  it("rejects malformed active-session data instead of claiming no sessions are running", async () => {
    const { session, request } = setup()
    request.mockResolvedValueOnce({ error: "Service unavailable" })

    await expect(session.active()).rejects.toThrow("data")
  })

  it("preserves parent pagination and a worktree's shell ownership", async () => {
    const { session, shell, request } = setup()
    request.mockResolvedValueOnce({ data: [{ id: "ses_child", agent: "general", location: { directory: "/work tree" } }], cursor: { next: "next-page" } })
    request.mockResolvedValueOnce({ data: [{ id: "sh_build", status: "running", metadata: { sessionID: "ses_child" } }] })

    const page = await session.list({ parentID: "ses_parent", limit: "20", cursor: "page+2" })
    const commands = await shell.list({ location: { directory: page.data[0].location.directory } })

    expect(request).toHaveBeenNthCalledWith(1, "get", "/api/session?parentID=ses_parent&limit=20&cursor=page%2B2")
    expect(page.cursor?.next).toBe("next-page")
    expect(request).toHaveBeenNthCalledWith(2, "get", "/api/shell?location%5Bdirectory%5D=%2Fwork+tree")
    expect(commands.data[0].metadata).toEqual({ sessionID: "ses_child" })
  })

  it("accepts the null cursor returned by OpenCode at the end of a child listing", async () => {
    const { session, request } = setup()
    request.mockResolvedValueOnce({ data: [], cursor: { previous: null, next: null } })

    await expect(session.list({ parentID: "ses_parent", limit: "20" })).resolves.toEqual({ data: [] })
  })
})
