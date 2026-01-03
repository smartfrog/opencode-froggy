import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, basename } from "node:path"
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
  permissions?: Record<string, unknown>
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
  model?: string
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

// ============================================================================
// HOOK TYPES
// ============================================================================

export type HookEvent =
  | "session.idle"
  | "session.created"
  | "session.deleted"
  | "tool.after.write"
  | "tool.after.edit"

export type HookCondition = "isMainSession" | "hasCodeChange"

export interface HookActionCommand {
  command: string | { name: string; args: string }
}

export interface HookActionSkill {
  skill: string
}

export interface HookActionTool {
  tool: { name: string; args: Record<string, unknown> }
}

export type HookAction = HookActionCommand | HookActionSkill | HookActionTool

export interface HookConfig {
  event: HookEvent
  conditions?: HookCondition[]
  actions: HookAction[]
}

interface HooksFileFrontmatter {
  hooks?: HookConfig[]
}

const VALID_HOOK_EVENTS: HookEvent[] = [
  "session.idle",
  "session.created",
  "session.deleted",
  "tool.after.write",
  "tool.after.edit",
]

export interface AgentConfigOutput {
  description: string
  mode: "subagent" | "primary" | "all"
  temperature?: number
  tools?: Record<string, boolean>
  permissions?: Record<string, unknown>
  prompt: string
  [key: string]: unknown
}

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

    const permissions = data.permissions ?? data.permission

    agents[agentName] = {
      description: data.description || "",
      mode,
      prompt: body.trim(),
      ...(data.temperature !== undefined && { temperature: data.temperature }),
      ...(data.tools !== undefined && { tools: data.tools }),
      ...(permissions !== undefined && { permissions }),
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
      model: data.model,
      template: body.trim(),
    }
  }

  return commands
}

function isValidHookEvent(event: string): event is HookEvent {
  return VALID_HOOK_EVENTS.includes(event as HookEvent)
}

export function loadHooks(hookDir: string): Map<HookEvent, HookConfig[]> {
  const hooks = new Map<HookEvent, HookConfig[]>()

  const hooksFilePath = join(hookDir, "hooks.md")
  if (!existsSync(hooksFilePath)) return hooks

  const content = readFileSync(hooksFilePath, "utf-8")
  const { data } = parseFrontmatter<HooksFileFrontmatter>(content)

  if (!data.hooks || !Array.isArray(data.hooks)) return hooks

  for (const hookDef of data.hooks) {
    if (!hookDef.event || !isValidHookEvent(hookDef.event)) continue
    if (!hookDef.actions || !Array.isArray(hookDef.actions)) continue

    const hookConfig: HookConfig = {
      event: hookDef.event,
      conditions: Array.isArray(hookDef.conditions) ? hookDef.conditions : undefined,
      actions: hookDef.actions,
    }

    const existing = hooks.get(hookDef.event)
    if (existing) {
      existing.push(hookConfig)
    } else {
      hooks.set(hookDef.event, [hookConfig])
    }
  }

  return hooks
}

export function mergeHooks(
  ...hookMaps: Map<HookEvent, HookConfig[]>[]
): Map<HookEvent, HookConfig[]> {
  const merged = new Map<HookEvent, HookConfig[]>()

  for (const hookMap of hookMaps) {
    for (const [event, configs] of hookMap) {
      const existing = merged.get(event) ?? []
      merged.set(event, [...existing, ...configs])
    }
  }

  return merged
}
