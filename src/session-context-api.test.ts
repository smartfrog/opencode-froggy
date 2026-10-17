import { describe, expect, it, vi } from "vitest"
import { createSessionContextClient, resolveProjectID } from "./session-context-api"
import { type OpenCodeRequest } from "./orchestrator-api"

function setup() {
  const request = vi.fn<OpenCodeRequest>()
  const fetchContext = vi.fn<(url: string, headers?: Record<string, string>) => Promise<unknown>>()
  const endpoint = vi.fn(async () => ({ url: "http://127.0.0.1:1234", password: "secret" }))
  return {
    request,
    fetchContext,
    client: createSessionContextClient({ request, fetchContext, resolveEndpoint: endpoint }),
  }
}

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "ses_main",
  parentID: null,
  projectID: "project-1",
  agent: "plan",
  model: { id: "deepseek-flash", providerID: "deepseek", variant: "high" },
  cost: 1.5,
  tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 100, write: 0 } },
  time: { created: 1, updated: 2 },
  title: "Main",
  ...overrides,
})

describe("session context API", () => {
  it("lists the requested project sessions in descending order", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({
      data: [
        session(),
        session({ id: "ses_child", parentID: "ses_main", agent: "memory-manager", title: "Curation" }),
      ],
    })

    const sessions = await client.listSessions("project-1", 10)

    expect(request).toHaveBeenCalledWith("get", "/api/session?limit=10&order=desc&project=project-1")
    expect(sessions).toEqual([
      {
        id: "ses_main",
        parentID: null,
        title: "Main",
        agent: "plan",
        model: "deepseek/deepseek-flash#high",
        modelKey: "deepseek/deepseek-flash",
        cost: 1.5,
        tokens: { input: 10, output: 2, cacheRead: 100 },
      },
      {
        id: "ses_child",
        parentID: "ses_main",
        title: "Curation",
        agent: "memory-manager",
        model: "deepseek/deepseek-flash#high",
        modelKey: "deepseek/deepseek-flash",
        cost: 1.5,
        tokens: { input: 10, output: 2, cacheRead: 100 },
      },
    ])
  })

  it("resolves the current directory to its project", async () => {
    const { request } = setup()
    request.mockResolvedValue({ project: { id: "project-1" } })

    await expect(resolveProjectID("/repo/sub", request)).resolves.toBe("project-1")
    expect(request).toHaveBeenCalledWith("get", "/api/location?location%5Bdirectory%5D=%2Frepo%2Fsub")
  })

  it("rejects sessions from another project", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({ data: [session({ projectID: "project-2" })] })

    await expect(client.listSessions("project-1", 1)).rejects.toThrow("different project")
  })

  it("rejects malformed session inventories", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({ data: [session({ parentID: "bad" })] })

    await expect(client.listSessions("project-1", 1)).rejects.toThrow("parent session id")
  })

  it("retrieves active context messages directly from the authenticated service", async () => {
    const { client, fetchContext } = setup()
    fetchContext.mockResolvedValue({ data: [{ type: "user", text: "hello" }] })

    await expect(client.getContext("ses_main")).resolves.toEqual([{ type: "user", text: "hello" }])
    expect(fetchContext).toHaveBeenCalledWith("http://127.0.0.1:1234/api/session/ses_main/context", {
      authorization: "Basic " + Buffer.from("opencode:secret").toString("base64"),
    })
  })

  it("rejects a non-list context response", async () => {
    const { client, fetchContext } = setup()
    fetchContext.mockResolvedValue({ data: { messages: [] } })

    await expect(client.getContext("ses_main")).rejects.toThrow("Invalid session context")
  })

  it("maps model identifiers to their context limits", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({
      data: [
        { providerID: "deepseek", modelID: "deepseek-flash", limit: { context: 1_000_000, output: 1 } },
        { providerID: "openai", id: "gpt-6.1-sol", limit: { context: 628_000, output: 1 } },
        { providerID: "invalid", modelID: "no-limit", limit: {} },
      ],
    })

    const limits = await client.listModelLimits("/repo")

    expect(request).toHaveBeenCalledWith("get", "/api/model?location%5Bdirectory%5D=%2Frepo")
    expect(limits.get("deepseek/deepseek-flash")).toBe(1_000_000)
    expect(limits.get("openai/gpt-6.1-sol")).toBe(628_000)
    expect(limits.size).toBe(2)
  })

  it("maps public and upstream model identifiers to the same limit", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({
      data: [{ providerID: "alias", id: "public-model", modelID: "upstream-model", limit: { context: 10_000, output: 1 } }],
    })

    const limits = await client.listModelLimits("/repo")

    expect(limits.get("alias/public-model")).toBe(10_000)
    expect(limits.get("alias/upstream-model")).toBe(10_000)
  })

  it("does not overwrite a public model limit with another model's alias", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({
      data: [
        { providerID: "alias", id: "base-model", modelID: "base-model", limit: { context: 10_000, output: 1 } },
        { providerID: "alias", id: "extended-model", modelID: "base-model", limit: { context: 100_000, output: 1 } },
      ],
    })

    const limits = await client.listModelLimits("/repo")

    expect(limits.get("alias/base-model")).toBe(10_000)
    expect(limits.get("alias/extended-model")).toBe(100_000)
  })

  it("retrieves the session identity used for service verification", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({ data: { id: "ses_main", time: { created: 123 } } })

    await expect(client.getSession("ses_main")).resolves.toEqual({ id: "ses_main", created: 123 })
    expect(request).toHaveBeenCalledWith("get", "/api/session/ses_main")
  })

  it("uses an injected host-bound context reader", async () => {
    const { request } = setup()
    const readContext = vi.fn(async () => [{ type: "user", text: "host context" }])
    const client = createSessionContextClient({ request, readContext })

    await expect(client.getContext("ses_main")).resolves.toEqual([{ type: "user", text: "host context" }])
    expect(readContext).toHaveBeenCalledWith("ses_main")
  })

  it("rejects a response without data", async () => {
    const { client, request } = setup()
    request.mockResolvedValue({})

    await expect(client.listModelLimits("/repo")).rejects.toThrow("missing data")
  })
})
