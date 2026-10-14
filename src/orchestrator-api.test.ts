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

  it("rejects malformed inbox data instead of claiming no reminders are pending", async () => {
    const { session, request } = setup()
    request.mockResolvedValueOnce({ data: { id: "ses_parent", time: { created: 123 } } })
    request.mockResolvedValueOnce({ error: "Service unavailable" })

    await expect(session.inbox.list({ sessionID: "ses_parent" })).rejects.toThrow("data")
  })
})
