import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../logger"

type Client = ReturnType<typeof createOpencodeClient>
type AgentMode = "subagent" | "primary" | "all"

const VALID_GRADES: AgentMode[] = ["subagent", "primary", "all"]

const promotedAgents = new Map<string, AgentMode>()

export function getPromotedAgents(): ReadonlyMap<string, AgentMode> {
  return promotedAgents
}

export interface AgentPromoteArgs {
  name: string
  grade: string
}

export function createAgentPromoteTool(client: Client, pluginAgentNames: string[]) {
  return tool({
    description: "Change the type of an agent to primary, subagent or all",
    args: {
      name: tool.schema.string().describe("Name of the agent"),
      grade: tool.schema.string().describe("Target type: 'subagent', 'primary', or 'all'"),
    },
    async execute(args: AgentPromoteArgs, _context: ToolContext) {
      const { name, grade } = args

      if (!VALID_GRADES.includes(grade as AgentMode)) {
        return `Invalid grade "${grade}". Valid grades: ${VALID_GRADES.join(", ")}`
      }

      if (!pluginAgentNames.includes(name)) {
        return `Agent "${name}" not found in this plugin. Available: ${pluginAgentNames.join(", ")}`
      }

      const agentsResp = await client.app.agents()
      const agents = agentsResp.data ?? []
      const existingAgent = agents.find((a) => a.name === name)

      if (existingAgent && existingAgent.mode === grade) {
        return `Agent "${name}" is already of type "${grade}"`
      }

      promotedAgents.set(name, grade as AgentMode)
      log("[agent-promote] Agent type changed", { name, grade })

      await client.tui.showToast({
        body: {
          message: `Promoting agent "${name}" to "${grade}"...`,
          variant: "success",
          duration: 3000,
        },
      })

      await client.instance.dispose()

      return `Agent "${name}" changed to type "${grade}". Use Tab or <leader>a to select it.`
    },
  })
}
