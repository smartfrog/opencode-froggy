import { type LoadedSkill } from "./loaders"

function formatTrigger(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function buildSkillInstruction(skill: LoadedSkill): string {
  return `MANDATORY: Call skill({ name: "${skill.name}" }) ${formatTrigger(skill.useWhen!)}`
}

export function buildSkillActivationBlock(skills: LoadedSkill[]): string {
  if (!Array.isArray(skills) || skills.length === 0) return ""
  return skills.map(buildSkillInstruction).join("\n\n")
}
