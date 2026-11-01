import { describe, expect, it, mock } from "bun:test"
import { createOrchestratorClients, type OpenCodeRequest } from "./orchestrator-api"

function setup() {
  const native = {
    get: mock(async () => ({ id: "ses_parent", time: { created: 123 } })),
    synthetic: mock(async () => ({ id: "msg_reminder" })),
  }
  const request = mock<OpenCodeRequest>()
  return { native, request, ...createOrchestratorClients(native, request) }
}

describe("orchestrator API bridge", () => {
  it("retrieves persisted children across every page for the requested parent", async () => {
    const { listChildren, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValueOnce({ data: [{ id: "ses_second", parentID: "ses_parent", title: "Second", time: { created: 2, updated: 3 } }], cursor: { next: "page+/2" } })
    request.mockResolvedValueOnce({ data: [{ id: "ses_first", parentID: "ses_parent", title: "First", time: { created: 1, updated: 4 } }], cursor: { next: null } })

    const children = await listChildren("ses_parent")

    expect(children).toEqual([
      { id: "ses_first", parentID: "ses_parent", title: "First", created: 1, updated: 4 },
      { id: "ses_second", parentID: "ses_parent", title: "Second", created: 2, updated: 3 },
    ])
    expect(request).toHaveBeenNthCalledWith(2, "get", "/api/session?parentID=ses_parent&limit=100")
    expect(request).toHaveBeenNthCalledWith(3, "get", "/api/session?parentID=ses_parent&limit=100&cursor=page%2B%2F2")
  })

  it("rejects a child belonging to a different parent", async () => {
    const { listChildren, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValueOnce({ data: [{ id: "ses_child", parentID: "ses_other", time: { created: 1, updated: 2 } }], cursor: {} })

    await expect(listChildren("ses_parent")).rejects.toThrow("parent")
  })

  it("rejects cursor cycles instead of returning a truncated inventory", async () => {
    const { listChildren, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValue({ data: [], cursor: { next: "same" } })

    await expect(listChildren("ses_parent")).rejects.toThrow("pagination")
  })

  it("does not return partial children after a later page fails", async () => {
    const { listChildren, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValueOnce({ data: [{ id: "ses_child", parentID: "ses_parent", time: { created: 1, updated: 2 } }], cursor: { next: "next" } })
    request.mockRejectedValueOnce(new Error("Second page unavailable"))

    await expect(listChildren("ses_parent")).rejects.toThrow("Second page unavailable")
  })

  it.each([
    { data: [] },
    { data: [], cursor: { next: 123 } },
    { data: [{ id: "ses_child", parentID: "ses_parent", time: { created: 1, updated: "invalid" } }], cursor: {} },
  ])("rejects malformed child inventory %j", async (response) => {
    const { listChildren, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValueOnce(response)

    await expect(listChildren("ses_parent")).rejects.toThrow("Invalid")
  })

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

    expect(request).toHaveBeenCalledTimes(1)
  })

  it("exposes the same service verification for session reporting", async () => {
    const { verifySession, request, native } = setup()
    request.mockResolvedValue({ data: { id: "ses_parent", time: { created: 123 } } })

    await verifySession("ses_parent")

    expect(native.get).toHaveBeenCalledWith({ sessionID: "ses_parent" })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith("get", "/api/session/ses_parent")
  })

  it.each([
    { id: "ses_other", time: { created: 123 } },
    { id: "ses_parent", time: { created: 999 } },
  ])("rejects a mismatched service identity %j for session reporting", async (remote) => {
    const { verifySession, request } = setup()
    request.mockResolvedValue({ data: remote })

    await expect(verifySession("ses_parent")).rejects.toThrow("same OpenCode service")
  })

  it.each([NaN, Infinity])("rejects a non-finite service creation timestamp %s", async (created) => {
    const { verifySession, request, native } = setup()
    native.get.mockResolvedValue({ id: "ses_parent", time: { created } })
    request.mockResolvedValue({ data: { id: "ses_parent", time: { created } } })

    await expect(verifySession("ses_parent")).rejects.toThrow("same OpenCode service")
  })

  it("rejects malformed inbox data instead of claiming no reminders are pending", async () => {
    const { session, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValueOnce({ error: "Service unavailable" })

    await expect(session.inbox.list({ sessionID: "ses_parent" })).rejects.toThrow("data")
  })
})
