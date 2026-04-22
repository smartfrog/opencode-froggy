import { tool, type ToolContext } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { parseFrontmatter, type LoadedSkill } from "../loaders"
import { log } from "../logger"

type Client = ReturnType<typeof createOpencodeClient>

export type SkillScope =
  | "plugin"
  | "opencode"
  | "opencode-project"
  | "claude"
  | "claude-project"

export interface SkillInfo {
  name: string
  description: string
  location: string
  scope: SkillScope
}

interface SkillFrontmatter {
  name?: string
  description?: string
}

const TOOL_DESCRIPTION_PREFIX = `Load a skill to get detailed instructions for a specific task.`
const TOOL_DESCRIPTION_NO_SKILLS = `${TOOL_DESCRIPTION_PREFIX} No skills are currently available.`

function discoverSkillsFromDir(skillsDir: string, scope: SkillScope): SkillInfo[] {
  if (!existsSync(skillsDir)) return []

  const skills: SkillInfo[] = []

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (!entry.isDirectory()) continue

      const skillMdPath = join(skillsDir, entry.name, "SKILL.md")
      if (!existsSync(skillMdPath)) continue

      try {
        const content = readFileSync(skillMdPath, "utf-8")
        const { data } = parseFrontmatter<SkillFrontmatter>(content)

        if (!data.name || !data.description) continue

        skills.push({
          name: data.name,
          description: data.description,
          location: skillMdPath,
          scope,
        })
      } catch {
        // Skip invalid skill files
      }
    }
  } catch {
    // Directory not accessible
  }

  return skills
}

function pluginSkillsToInfo(skills: LoadedSkill[], pluginDir: string): SkillInfo[] {
  return skills.map(s => ({
    name: s.name,
    description: s.description,
    location: s.path || join(pluginDir, "skill", s.name, "SKILL.md"),
    scope: "plugin" as const,
  }))
}

function formatSkillItems(skills: SkillInfo[]): string {
  return skills
    .map(skill => [
      "  <skill>",
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
      "  </skill>",
    ].join("\n"))
    .join("\n")
}

function formatSkillsXml(skills: SkillInfo[]): string {
  if (skills.length === 0) return ""
  return `<available_skills>\n${formatSkillItems(skills)}\n</available_skills>`
}

export interface DiscoverAllSkillsOptions {
  pluginSkills: LoadedSkill[]
  pluginDir: string
  cwd: string
}

export function discoverAllSkills(options: DiscoverAllSkillsOptions): SkillInfo[] {
  const { pluginSkills, pluginDir, cwd } = options

  // Merge order: plugin < claude global < opencode global < claude project < opencode project
  // Later entries override earlier on name collision (project > global > plugin)
  const allSkills = [
    ...pluginSkillsToInfo(pluginSkills, pluginDir),
    ...discoverSkillsFromDir(join(homedir(), ".claude", "skills"), "claude"),
    ...discoverSkillsFromDir(join(homedir(), ".config", "opencode", "skills"), "opencode"),
    ...discoverSkillsFromDir(join(cwd, ".claude", "skills"), "claude-project"),
    ...discoverSkillsFromDir(join(cwd, ".opencode", "skills"), "opencode-project"),
  ]

  const skillMap = new Map<string, SkillInfo>()
  for (const skill of allSkills) {
    skillMap.set(skill.name, skill)
  }

  return Array.from(skillMap.values())
}

export function formatPluginSkillsAsXmlItems(
  skills: LoadedSkill[],
  pluginDir: string
): string {
  if (skills.length === 0) return ""
  return formatSkillItems(pluginSkillsToInfo(skills, pluginDir))
}

function loadSkillContent(location: string): string {
  const content = readFileSync(location, "utf-8")
  const { body } = parseFrontmatter<SkillFrontmatter>(content)
  return body.trim()
}

export interface CreateSkillToolOptions {
  pluginSkills: LoadedSkill[]
  pluginDir: string
  cwd: string
  client: Client
}

export function createSkillTool(options: CreateSkillToolOptions) {
  const { client, pluginDir, pluginSkills, cwd } = options
  const skills = discoverAllSkills({ pluginSkills, pluginDir, cwd })

  const description = skills.length === 0
    ? TOOL_DESCRIPTION_NO_SKILLS
    : `${TOOL_DESCRIPTION_PREFIX}\n\n${formatSkillsXml(skills)}`

  return tool({
    description,
    args: {
      name: tool.schema
        .string()
        .describe("The skill identifier from available_skills (e.g., 'tdd', 'openspec-propose')"),
    },
    async execute(args: { name: string }, _context: ToolContext) {
      const skill = skills.find(s => s.name === args.name)

      if (!skill) {
        const available = skills.map(s => s.name).join(", ")
        throw new Error(
          `Skill "${args.name}" not found. Available skills: ${available || "none"}`
        )
      }

      const body = loadSkillContent(skill.location)
      const dir = dirname(skill.location)

      try {
        await client.tui.showToast({
          body: {
            message: `Skill "${skill.name}" loaded`,
            variant: "info",
            duration: 3000,
          },
        })
      } catch (error) {
        log("[skill] Failed to show toast", { error: String(error) })
      }

      return [
        `## Skill: ${skill.name}`,
        "",
        `**Base directory**: ${dir}`,
        "",
        body,
      ].join("\n")
    },
  })
}
