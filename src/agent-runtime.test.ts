import { describe, it, expect, jest, mock } from "bun:test"
import { Agent } from "@opencode/plugin"
import { applyAgents, createAgentModes } from "./agent-runtime"

function instance(reload = mock<() => Promise<void>>().mockResolvedValue()) {
  return createAgentModes(["reviewer"], reload)
}

describe("plugin agents", () => {
  it("registers a bundled agent with its instructions and restrictions", () => {
    const agents = new Map<string, ReturnType<typeof Agent.Info.default>>()
    applyAgents({
      update: (name, update) => {
        const agent = agents.get(name) ?? structuredClone(Agent.Info.default(Agent.ID.make(name)))
        update(agent)
        agents.set(name, agent)
      },
      remove: (name) => { agents.delete(name) },
    }, { reviewer: {
      description: "Review", mode: "subagent", prompt: "Inspect changes",
      permissions: [{ action: "edit", resource: "*", effect: "deny" }],
    } }, {})
    expect(agents.get("reviewer")).toMatchObject({
      system: "Inspect changes", description: "Review", mode: "subagent",
      permissions: expect.arrayContaining([{ action: "edit", resource: "*", effect: "deny" }]),
    })
  })

  it("resets promotions when the plugin unloads", async () => {
    const first = instance()
    await first.set("reviewer", "primary")
    const restarted = instance()
    expect(restarted.values.reviewer).toBeUndefined()
  })

  it("isolates promotions from another active project", async () => {
    const reload = mock<() => Promise<void>>().mockResolvedValue()
    const other = instance(reload)
    const first = instance()
    await first.set("reviewer", "all")
    expect(first.values.reviewer).toBe("all")
    expect(other.values.reviewer).toBeUndefined()
    expect(reload).not.toHaveBeenCalled()
  })

  it("reports registry reload failures", async () => {
    const modes = instance(mock().mockRejectedValue(new Error("reload failed")))
    await expect(modes.set("reviewer", "primary")).rejects.toThrow("reload failed")
  })
})
