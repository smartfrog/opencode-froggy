import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, basename, extname } from "node:path"
import yaml from "js-yaml"

// ============================================================================
// TYPES
// ============================================================================

export interface AgentFrontmatter {
  description: string
  mode?: "subagent" | "agent"
  temperature?: number
  tools?: Record<string, boolean>
  permission?: Record<string, unknown>
}

export interface SkillFrontmatter {
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
}

export interface CommandFrontmatter {
  description: string
  agent?: string
}

export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}

export interface LoadedSkill {
  name: string
  description: string
  path: string
  body: string
}

export interface AgentConfigOutput {
  description: string
  mode: "subagent" | "primary" | "all"
  temperature?: number
  tools?: Record<string, boolean>
  prompt: string
  [key: string]: unknown
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".scala",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
  ".php", ".vue", ".svelte", ".astro",
  ".sh", ".bash", ".zsh", ".fish",
  ".sql", ".graphql", ".prisma",
  ".yaml", ".yml", ".toml",
])

// ============================================================================
// UTILITIES
// ============================================================================

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

export function isCodeFile(filePath: unknown): boolean {
  if (typeof filePath !== "string") return false
  const ext = extname(filePath).toLowerCase()
  return CODE_EXTENSIONS.has(ext)
}

// ============================================================================
// LOADERS
// ============================================================================

export function loadAgents(agentDir: string): Record<string, AgentConfigOutput> {
  if (!existsSync(agentDir)) return {}

  const agents: Record<string, AgentConfigOutput> = {}

  for (const file of readdirSync(agentDir)) {
    if (!file.endsWith(".md")) continue

    const filePath = join(agentDir, file)
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<AgentFrontmatter>(content)

    const agentName = basename(file, ".md")
    const mode = data.mode === "agent" ? "primary" : "subagent"

    agents[agentName] = {
      description: data.description || "",
      mode,
      temperature: data.temperature,
      tools: data.tools,
      prompt: body.trim(),
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
      template: body.trim(),
    }
  }

  return commands
}
