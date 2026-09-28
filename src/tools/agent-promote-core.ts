export type AgentMode = "subagent" | "primary" | "all"

export const VALID_GRADES: AgentMode[] = ["subagent", "primary", "all"]

export function validateGrade(grade: string): grade is AgentMode {
  return VALID_GRADES.includes(grade as AgentMode)
}

export function validateAgentName(name: string, pluginAgentNames: string[]): boolean {
  return pluginAgentNames.includes(name)
}
