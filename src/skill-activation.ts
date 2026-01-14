import { type LoadedSkill } from "./loaders"

function escapeTrigger(text: string): string {
  return text.replace(/"/g, "&quot;").replace(/\n/g, " ").trim()
}

export function buildSkillActivationBlock(skills: LoadedSkill[]): string {
  const rules = skills
    .map(s => `  <rule skill="${s.name}" trigger="${escapeTrigger(s.useWhen!)}"/>`)
    .join("\n")

  return `<skill-activation-rules>
MANDATORY: Call skill({ name }) BEFORE responding when trigger matches.

${rules}
</skill-activation-rules>`
}
