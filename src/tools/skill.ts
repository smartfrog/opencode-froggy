import { tool, type ToolContext } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { parseFrontmatter, type LoadedSkill } from "../loaders"
import { log } from "../logger"

type Client = ReturnType<typeof createOpencodeClient>

export interface SkillInfo {
  name: string
  description: string
  location: string
  scope: "plugin" | "opencode" | "opencode-project" | "claude" | "claude-project"
}

interface SkillFrontmatter {
  name?: string
  description?: string
}

const TOOL_DESCRIPTION_PREFIX = `Load a skill to get detailed instructions for a specific task.`
const TOOL_DESCRIPTION_NO_SKILLS = `${TOOL_DESCRIPTION_PREFIX} No skills are currently available.`

function discoverSkillsFromDir(
  skillsDir: string,
  scope: SkillInfo["scope"]
): SkillInfo[] {
  if (!existsSync(skillsDir)) return []

  const skills: SkillInfo[] = []

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue

      const entryPath = join(skillsDir, entry.name)

      if (entry.isDirectory()) {
        const skillMdPath = join(entryPath, "SKILL.md")
        if (!existsSync(skillMdPath)) continue

        try {
          const content = readFileSync(skillMdPath, "utf-8")
          const { data } = parseFrontmatter<SkillFrontmatter>(content)

          if (data.name && data.description) {
            skills.push({
              name: data.name,
              description: data.description,
              location: skillMdPath,
              scope,
            })
          }
        } catch {
          // Skip invalid skill files
        }
      }
    }
  } catch {
    // Directory not accessible
  }

  return skills
}

function discoverOpencodeGlobalSkills(): SkillInfo[] {
  const skillsDir = join(homedir(), ".config", "opencode", "skill")
  return discoverSkillsFromDir(skillsDir, "opencode")
}

function discoverOpencodeProjectSkills(cwd: string): SkillInfo[] {
  const skillsDir = join(cwd, ".opencode", "skill")
  return discoverSkillsFromDir(skillsDir, "opencode-project")
}

function discoverClaudeGlobalSkills(): SkillInfo[] {
  const skillsDir = join(homedir(), ".claude", "skills")
  return discoverSkillsFromDir(skillsDir, "claude")
}

function discoverClaudeProjectSkills(cwd: string): SkillInfo[] {
  const skillsDir = join(cwd, ".claude", "skills")
  return discoverSkillsFromDir(skillsDir, "claude-project")
}

function pluginSkillsToInfo(skills: LoadedSkill[], pluginDir: string): SkillInfo[] {
  return skills.map(s => ({
    name: s.name,
    description: s.description,
    location: s.path || join(pluginDir, "skill", s.name, "SKILL.md"),
    scope: "plugin" as const,
  }))
}

function formatSkillsXml(skills: SkillInfo[]): string {
  if (skills.length === 0) return ""

  const skillsXml = skills
    .map(skill => {
      return [
        "  <skill>",
        `    <name>${skill.name}</name>`,
        `    <description>${skill.description}</description>`,
        "  </skill>",
      ].join("\n")
    })
    .join("\n")

  return `\n\n<available_skills>\n${skillsXml}\n</available_skills>`
}

function loadSkillContent(location: string): string {
  const content = readFileSync(location, "utf-8")
  const { body } = parseFrontmatter<SkillFrontmatter>(content)
  return body.trim()
}

export interface CreateSkillToolOptions {
  pluginSkills: LoadedSkill[]
  pluginDir: string
  client: Client
}

export function createSkillTool(options: CreateSkillToolOptions) {
  let cachedSkills: SkillInfo[] | null = null
  let cachedDescription: string | null = null
  const { client, pluginDir, pluginSkills } = options

  const getSkills = (cwd: string): SkillInfo[] => {
    if (cachedSkills) return cachedSkills

    // Merge order: plugin defaults < global < project (later entries override earlier on name collision)
    const allSkills = [
      ...pluginSkillsToInfo(pluginSkills, pluginDir),
      ...discoverClaudeGlobalSkills(),
      ...discoverOpencodeGlobalSkills(),
      ...discoverClaudeProjectSkills(cwd),
      ...discoverOpencodeProjectSkills(cwd),
    ]

    // Deduplicate by name - last definition wins (project > global > plugin)
    const skillMap = new Map<string, SkillInfo>()
    for (const skill of allSkills) {
      skillMap.set(skill.name, skill)
    }

    cachedSkills = Array.from(skillMap.values())
    return cachedSkills
  }

  const getDescription = (cwd: string): string => {
    if (cachedDescription) return cachedDescription

    const skills = getSkills(cwd)
    cachedDescription =
      skills.length === 0
        ? TOOL_DESCRIPTION_NO_SKILLS
        : TOOL_DESCRIPTION_PREFIX + formatSkillsXml(skills)

    return cachedDescription
  }

  // Pre-compute with current working directory
  const cwd = process.cwd()
  getDescription(cwd)

  return tool({
    get description() {
      return cachedDescription ?? TOOL_DESCRIPTION_PREFIX
    },
    args: {
      name: tool.schema
        .string()
        .describe("The skill identifier from available_skills (e.g., 'code-review' or 'category/helper')"),
    },
    async execute(args: { name: string }, _context: ToolContext) {
      const skills = getSkills(cwd)
      const skill = skills.find(s => s.name === args.name)

      if (!skill) {
        const available = skills.map(s => s.name).join(", ")
        throw new Error(`Skill "${args.name}" not found. Available skills: ${available || "none"}`)
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
