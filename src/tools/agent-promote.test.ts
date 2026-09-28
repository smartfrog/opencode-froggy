import { describe, it, expect, vi } from "vitest"
import { createAgentPromoteTool } from "./agent-promote"

describe("agent-promote", () => {
  it("reads the SDK's location-wrapped agent response", async () => {
    const tool = createAgentPromoteTool({ get: async () => ({ data: { mode: "all" } }) }, vi.fn(), ["reviewer"])
    expect((await tool.execute({ name: "reviewer", grade: "all" })).content).toContain('changed to type "all"')
  })

  it("confirms the effective mode after reloading", async () => {
    let mode = "subagent"
    const set = vi.fn(async (_name: string, grade: string) => { mode = grade })
    const tool = createAgentPromoteTool({ get: async () => ({ mode }) }, set, ["reviewer"])
    expect((await tool.execute({ name: "reviewer" })).content).toContain('changed to type "primary"')
    expect(set).toHaveBeenCalledWith("reviewer", "primary")
  })

  it("reports a later configuration override instead of claiming success", async () => {
    const tool = createAgentPromoteTool({ get: async () => ({ mode: "subagent" }) }, vi.fn(), ["reviewer"])
    expect((await tool.execute({ name: "reviewer" })).content).toContain("configuration override")
  })

  it("rejects agents outside the plugin", async () => {
    const set = vi.fn()
    const tool = createAgentPromoteTool({ get: vi.fn() }, set, ["reviewer"])
    expect((await tool.execute({ name: "build" })).content).toContain("not found in this plugin")
    expect(set).not.toHaveBeenCalled()
  })

  it("rejects an invalid mode", async () => {
    const set = vi.fn()
    const tool = createAgentPromoteTool({ get: vi.fn() }, set, ["reviewer"])
    expect((await tool.execute({ name: "reviewer", grade: "boss" })).content).toContain("Invalid grade")
    expect(set).not.toHaveBeenCalled()
  })

  it("propagates a reload failure", async () => {
    const tool = createAgentPromoteTool({ get: vi.fn() }, async () => { throw new Error("reload failed") }, ["reviewer"])
    await expect(tool.execute({ name: "reviewer" })).rejects.toThrow("reload failed")
  })

  it("reports a disabled or missing effective agent", async () => {
    const tool = createAgentPromoteTool({ get: async () => undefined }, vi.fn(), ["reviewer"])
    expect((await tool.execute({ name: "reviewer" })).content).toContain("unavailable")
  })
})
