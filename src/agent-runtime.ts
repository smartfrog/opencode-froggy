import { Model, Provider } from "@opencode/plugin"
import { type AgentEditor } from "@opencode/plugin/promise/agent"
import { type AgentConfigOutput } from "./loaders"
import { type AgentMode, validateGrade } from "./tools/agent-promote-core"

export function createAgentModes(names: string[], reload: () => Promise<void>) {
  const values: Record<string, AgentMode> = {}
  return {
    values,
    set: async (name: string, mode: AgentMode) => {
      if (!names.includes(name) || !validateGrade(mode)) throw new Error("Invalid agent promotion")
      values[name] = mode
      await reload()
    },
  }
}

type AgentDraft = Parameters<Parameters<AgentEditor["update"]>[1]>[0]

function permissions(input: unknown): AgentDraft["permissions"] {
  if (input === undefined) return []
  if (Array.isArray(input)) {
    return input.map((rule: unknown) => {
      if (!rule || typeof rule !== "object") throw new Error("Invalid agent permission rule")
      const { action, resource, effect } = rule as Record<string, unknown>
      if (typeof action !== "string" || typeof resource !== "string" ||
          (effect !== "allow" && effect !== "deny" && effect !== "ask")) {
        throw new Error("Invalid agent permission rule")
      }
      return { action, resource, effect }
    })
  }
  if (typeof input !== "object" || input === null) throw new Error("Invalid agent permissions")
  return Object.entries(input).flatMap(([action, value]) => {
    const resources = typeof value === "string" ? { "*": value } : value
    if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
      throw new Error(`Invalid permission for "${action}"`)
    }
    return Object.entries(resources).map(([resource, effect]) => {
      if (effect !== "allow" && effect !== "deny" && effect !== "ask") throw new Error("Invalid permission effect")
      return { action: action === "bash" ? "shell" : action, resource, effect }
    })
  })
}

export function applyAgents(
  editor: Pick<AgentEditor, "update" | "remove">,
  agents: Record<string, AgentConfigOutput>,
  modes: Record<string, AgentMode>,
) {
  for (const [name, config] of Object.entries(agents)) {
    if (config.disable) {
      editor.remove(name)
      continue
    }
    if (!validateGrade(config.mode)) throw new Error(`Invalid mode for agent "${name}"`)
    editor.update(name, (agent) => {
      agent.description = config.description
      agent.system = config.prompt
      agent.mode = modes[name] ?? config.mode
      if (config.model) {
        const slash = config.model.indexOf("/")
        if (slash < 1 || slash === config.model.length - 1) throw new Error(`Invalid model for agent "${name}"`)
        agent.model = {
          providerID: Provider.ID.make(config.model.slice(0, slash)),
          id: Model.ID.make(config.model.slice(slash + 1)),
        }
      }
      if (config.temperature !== undefined) agent.request.settings.temperature = config.temperature
      if (config.maxSteps !== undefined) agent.steps = config.maxSteps
      for (const [tool, enabled] of Object.entries(config.tools ?? {})) {
        agent.permissions.push({ action: tool === "bash" ? "shell" : tool, resource: "*", effect: enabled ? "allow" : "deny" })
      }
      agent.permissions.push(...permissions(config.permissions))
    })
  }
}
