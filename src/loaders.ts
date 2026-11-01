import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, basename } from "node:path"
import yaml from "js-yaml"

export interface AgentFrontmatter {
  description: string
  mode?: "primary" | "subagent" | "all"
  model?: string
  temperature?: number
  maxSteps?: number
  disable?: boolean
  permissions?: Array<{
    action: string
    resource: string
    effect: "allow" | "deny" | "ask"
  }>
}

export interface SkillFrontmatter {
  name: string
  description: string
  use_when?: string
}

export interface CommandFrontmatter {
  description: string
  agent?: string
  model?: string
  subagent?: boolean
  subtask?: boolean
}

export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
  subagent?: boolean
  subtask?: boolean
}

export interface LoadedSkill {
  name: string
  description: string
  useWhen?: string
  path: string
  body: string
}

export interface AgentConfigOutput extends AgentFrontmatter {
  mode: "subagent" | "primary" | "all"
  prompt: string
}

export function parseFrontmatter<T>(content: unknown): { data: T; body: string } {
  if (typeof content !== "string") {
    return { data: {} as T, body: "" }
  }
  const match = content.match(/^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n)?([\s\S]*)$/)
  if (!match) {
    return { data: {} as T, body: content }
  }
  try {
    const yamlContent = match[1].trim()
    const parsed = yamlContent ? yaml.load(yamlContent) : null
    return { data: (parsed as T) ?? ({} as T), body: match[2] }
  } catch {
    return { data: {} as T, body: content }
  }
}

export function loadAgents(agentDir: string): Record<string, AgentConfigOutput> {
  if (!existsSync(agentDir)) return {}

  const agents: Record<string, AgentConfigOutput> = {}

  for (const file of readdirSync(agentDir)) {
    if (!file.endsWith(".md")) continue

    const filePath = join(agentDir, file)
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<AgentFrontmatter>(content)
    if (Object.hasOwn(data, "permission") || Object.hasOwn(data, "tools")) {
      throw new Error(`Unsupported legacy agent field in ${file}; use V2 permissions rules`)
    }

    const agentName = basename(file, ".md")
    const mode = data.mode ?? "all"

    agents[agentName] = {
      description: data.description || "",
      mode,
      prompt: body.trim(),
      ...(data.model !== undefined && { model: data.model }),
      ...(data.temperature !== undefined && { temperature: data.temperature }),
      ...(data.maxSteps !== undefined && { maxSteps: data.maxSteps }),
      ...(data.disable !== undefined && { disable: data.disable }),
      ...(data.permissions !== undefined && { permissions: data.permissions }),
    }
  }

  return agents
}

export function loadSkills(skillDir: string): LoadedSkill[] {
  if (!existsSync(skillDir)) return []

  const skills: LoadedSkill[] = []

  for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const skillPath = join(skillDir, entry.name, "SKILL.md")
    if (!existsSync(skillPath)) continue

    const content = readFileSync(skillPath, "utf-8")
    const { data, body } = parseFrontmatter<SkillFrontmatter>(content)

    skills.push({
      name: data.name || entry.name,
      description: data.description || "",
      useWhen: data.use_when,
      path: skillPath,
      body: body.trim(),
    })
  }

  return skills
}

export function loadCommands(commandDir: string): Record<string, CommandConfig> {
  if (!existsSync(commandDir)) return {}

  const commands: Record<string, CommandConfig> = {}

  for (const file of readdirSync(commandDir)) {
    if (!file.endsWith(".md")) continue

    const filePath = join(commandDir, file)
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

    const commandName = basename(file, ".md")

    commands[commandName] = {
      description: data.description || "",
      agent: data.agent,
      model: data.model,
      subagent: data.subagent,
      subtask: data.subtask,
      template: body.trim(),
    }
  }

  return commands
}
