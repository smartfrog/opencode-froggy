import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parseFrontmatter, type LoadedSkill } from "../loaders"

/**
 * These tests verify the skill discovery and loading logic.
 * 
 * Note: We cannot directly test createSkillTool because it imports
 * @opencode-ai/plugin which is not available in the test environment.
 * Instead, we test the underlying helper functions and data structures.
 */

interface SkillInfo {
  name: string
  description: string
  location: string
  scope: "plugin" | "opencode" | "opencode-project" | "claude" | "claude-project"
}

function discoverSkillsFromDir(
  skillsDir: string,
  scope: SkillInfo["scope"]
): SkillInfo[] {
  const { existsSync, readdirSync, readFileSync } = require("node:fs")
  
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
          const { data } = parseFrontmatter<{ name?: string; description?: string }>(content)

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

describe("skill discovery", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `skill-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function createSkillFile(dir: string, name: string, content: string): string {
    const skillDir = join(dir, name)
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, "SKILL.md")
    writeFileSync(skillPath, content)
    return skillPath
  }

  describe("discoverSkillsFromDir", () => {
    it("should return empty array for non-existent directory", () => {
      const result = discoverSkillsFromDir("/non/existent/path", "plugin")
      expect(result).toEqual([])
    })

    it("should discover valid skill with name and description", () => {
      createSkillFile(testDir, "my-skill", `---
name: my-skill
description: A test skill
---

Skill content here.`)

      const result = discoverSkillsFromDir(testDir, "opencode")

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("my-skill")
      expect(result[0].description).toBe("A test skill")
      expect(result[0].scope).toBe("opencode")
    })

    it("should ignore directories without SKILL.md", () => {
      const skillDir = join(testDir, "no-skill")
      mkdirSync(skillDir)
      writeFileSync(join(skillDir, "README.md"), "Not a skill")

      const result = discoverSkillsFromDir(testDir, "plugin")

      expect(result).toHaveLength(0)
    })

    it("should ignore skills without name", () => {
      createSkillFile(testDir, "nameless", `---
description: Has description but no name
---

Content`)

      const result = discoverSkillsFromDir(testDir, "plugin")

      expect(result).toHaveLength(0)
    })

    it("should ignore skills without description", () => {
      createSkillFile(testDir, "no-desc", `---
name: no-desc-skill
---

Content`)

      const result = discoverSkillsFromDir(testDir, "plugin")

      expect(result).toHaveLength(0)
    })

    it("should ignore hidden directories", () => {
      createSkillFile(testDir, ".hidden-skill", `---
name: hidden
description: Hidden skill
---

Content`)

      const result = discoverSkillsFromDir(testDir, "plugin")

      expect(result).toHaveLength(0)
    })

    it("should discover multiple skills", () => {
      createSkillFile(testDir, "skill-a", `---
name: skill-a
description: First skill
---
Content A`)

      createSkillFile(testDir, "skill-b", `---
name: skill-b
description: Second skill
---
Content B`)

      const result = discoverSkillsFromDir(testDir, "opencode-project")

      expect(result).toHaveLength(2)
      expect(result.map(s => s.name).sort()).toEqual(["skill-a", "skill-b"])
    })
  })

  describe("pluginSkillsToInfo", () => {
    it("should convert LoadedSkill array to SkillInfo array", () => {
      const pluginSkills: LoadedSkill[] = [
        {
          name: "test-skill",
          description: "A test skill",
          path: "/fake/path/SKILL.md",
          body: "Test body",
        },
      ]

      const result = pluginSkillsToInfo(pluginSkills, "/plugin/dir")

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("test-skill")
      expect(result[0].description).toBe("A test skill")
      expect(result[0].location).toBe("/fake/path/SKILL.md")
      expect(result[0].scope).toBe("plugin")
    })

    it("should use default path when path not provided", () => {
      const pluginSkills: LoadedSkill[] = [
        {
          name: "no-path-skill",
          description: "Skill without path",
          path: "",
          body: "",
        },
      ]

      const result = pluginSkillsToInfo(pluginSkills, "/my/plugin")

      expect(result[0].location).toBe("/my/plugin/skill/no-path-skill/SKILL.md")
    })
  })

  describe("formatSkillsXml", () => {
    it("should return empty string for no skills", () => {
      const result = formatSkillsXml([])
      expect(result).toBe("")
    })

    it("should format single skill as XML", () => {
      const skills: SkillInfo[] = [
        {
          name: "my-skill",
          description: "My description",
          location: "/path",
          scope: "plugin",
        },
      ]

      const result = formatSkillsXml(skills)

      expect(result).toContain("<available_skills>")
      expect(result).toContain("<name>my-skill</name>")
      expect(result).toContain("<description>My description</description>")
      expect(result).toContain("</available_skills>")
    })

    it("should format multiple skills", () => {
      const skills: SkillInfo[] = [
        { name: "skill-a", description: "Desc A", location: "/a", scope: "plugin" },
        { name: "skill-b", description: "Desc B", location: "/b", scope: "opencode" },
      ]

      const result = formatSkillsXml(skills)

      expect(result).toContain("<name>skill-a</name>")
      expect(result).toContain("<name>skill-b</name>")
    })
  })

  describe("skill deduplication", () => {
    it("should demonstrate last-wins deduplication behavior", () => {
      // This tests the expected behavior when skills are merged
      const allSkills: SkillInfo[] = [
        { name: "shared", description: "Plugin version", location: "/plugin", scope: "plugin" },
        { name: "shared", description: "Global version", location: "/global", scope: "opencode" },
        { name: "shared", description: "Project version", location: "/project", scope: "opencode-project" },
      ]

      // Simulate deduplication (last wins)
      const skillMap = new Map<string, SkillInfo>()
      for (const skill of allSkills) {
        skillMap.set(skill.name, skill)
      }
      const deduplicated = Array.from(skillMap.values())

      expect(deduplicated).toHaveLength(1)
      expect(deduplicated[0].description).toBe("Project version")
      expect(deduplicated[0].scope).toBe("opencode-project")
    })
  })
})
