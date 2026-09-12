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

export interface AgentPromoteArgs {
  name: string
  grade?: string
}

interface AgentReader {
  get(input: { agentID: string }): Promise<{ data?: { mode?: string } } | { mode?: string }>
}

interface AgentReloader {
  reload(): Promise<void>
}

interface PluginStorage {
  set(key: string, value: unknown): Promise<void>
}

const STORAGE_KEY = "promoted-agents"

export function createAgentPromoteTool(
  agent: AgentReader,
  reloader: AgentReloader,
  storage: PluginStorage,
  pluginAgentNames: string[]
) {
  return {
    name: "agent-promote",
    description: "Change the type of an agent to primary, subagent or all",
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the agent" },
        grade: {
          type: "string",
          description: "Target type: 'subagent', 'primary', or 'all' (default: primary)",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(input: unknown) {
      const args = input as AgentPromoteArgs
      const { name } = args
      const grade = args.grade?.trim() || "primary"

      if (!validateGrade(grade)) {
        return { content: `Invalid grade "${grade}". Valid grades: ${VALID_GRADES.join(", ")}` }
      }

      if (!validateAgentName(name, pluginAgentNames)) {
        return {
          content: `Agent "${name}" not found in this plugin. Available: ${pluginAgentNames.join(", ")}`,
        }
      }

      const existing = await agent.get({ agentID: name })
      const currentMode = (existing as { data?: { mode?: string } }).data?.mode
        ?? (existing as { mode?: string }).mode
      if (currentMode === grade) {
        return { content: `Agent "${name}" is already of type "${grade}"` }
      }

      setPromotedAgent(name, grade as AgentMode)
      log("[agent-promote] Agent type changed", { name, grade })

      const record: Record<string, AgentMode> = {}
      for (const [key, value] of getPromotedAgents()) record[key] = value
      await storage.set(STORAGE_KEY, record)
      await reloader.reload()

      return { content: `Agent "${name}" changed to type "${grade}".` }
    },
  }
}

export { STORAGE_KEY as AGENT_PROMOTE_STORAGE_KEY }
