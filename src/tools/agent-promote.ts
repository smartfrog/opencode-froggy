import { type AgentMode, VALID_GRADES, validateGrade, validateAgentName } from "./agent-promote-core"

export { type AgentMode, VALID_GRADES, validateGrade, validateAgentName } from "./agent-promote-core"

export interface AgentPromoteArgs {
  name: string
  grade?: string
}

interface AgentReader {
  get(input: { agentID: string }): Promise<{ mode: string } | { data: { mode: string } } | undefined>
}

export function createAgentPromoteTool(
  agent: AgentReader,
  setMode: (name: string, mode: AgentMode) => Promise<void>,
  pluginAgentNames: string[],
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
      if (!input || typeof input !== "object") throw new Error("Expected agent promotion arguments")
      const { name, grade: requested } = input as Record<string, unknown>
      if (typeof name !== "string" || (requested !== undefined && typeof requested !== "string")) {
        throw new Error("Expected an agent name and optional grade")
      }
      const grade = typeof requested === "string" ? requested.trim() || "primary" : "primary"
      if (!validateGrade(grade)) {
        return { content: `Invalid grade "${grade}". Valid grades: ${VALID_GRADES.join(", ")}` }
      }
      if (!validateAgentName(name, pluginAgentNames)) {
        return { content: `Agent "${name}" not found in this plugin. Available: ${pluginAgentNames.join(", ")}` }
      }
      await setMode(name, grade)
      const result = await agent.get({ agentID: name })
      const effective = result && "data" in result ? result.data : result
      if (!effective) {
        return { content: `Mode "${grade}" requested, but agent "${name}" is unavailable. Check disabled agents in your configuration.` }
      }
      if (effective.mode !== grade) {
        return { content: `Mode "${grade}" requested for "${name}", but its effective mode is "${effective.mode}". A configuration override or later plugin takes precedence; reconcile it before retrying.` }
      }
      return { content: `Agent "${name}" changed to type "${grade}".` }
    },
  }
}
