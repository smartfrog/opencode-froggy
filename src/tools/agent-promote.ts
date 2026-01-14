import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../logger"
import {
  type AgentMode,
  VALID_GRADES,
  getPromotedAgents,
  setPromotedAgent,
  validateGrade,
  validateAgentName,
} from "./agent-promote-core"

export {
  type AgentMode,
  VALID_GRADES,
  getPromotedAgents,
  setPromotedAgent,
  validateGrade,
  validateAgentName,
} from "./agent-promote-core"

type Client = ReturnType<typeof createOpencodeClient>

export interface AgentPromoteArgs {
  name: string
  grade?: string
}

export function createAgentPromoteTool(client: Client, pluginAgentNames: string[]) {
  return tool({
    description: "Change the type of an agent to primary, subagent or all",
    args: {
      name: tool.schema.string().describe("Name of the agent"),
      grade: tool.schema.string().optional().describe("Target type: 'subagent', 'primary', or 'all' (default: primary)"),
    },
    async execute(args: AgentPromoteArgs, _context: ToolContext) {
      const { name } = args
      const grade = args.grade?.trim() || "primary"

      if (!validateGrade(grade)) {
        return `Invalid grade "${grade}". Valid grades: ${VALID_GRADES.join(", ")}`
      }

      if (!validateAgentName(name, pluginAgentNames)) {
        return `Agent "${name}" not found in this plugin. Available: ${pluginAgentNames.join(", ")}`
      }

      const agentsResp = await client.app.agents()
      const agents = agentsResp.data ?? []
      const existingAgent = agents.find((a) => a.name === name)

      if (existingAgent && existingAgent.mode === grade) {
        return `Agent "${name}" is already of type "${grade}"`
      }

      setPromotedAgent(name, grade)
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
