import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  discoverAllSkills,
  formatPluginSkillsAsXmlItems,
  type SkillInfo,
} from "./skill"
import { type LoadedSkill } from "../loaders"

function createSkillFile(dir: string, name: string, content: string): string {
  const skillDir = join(dir, name)
  mkdirSync(skillDir, { recursive: true })
  const skillPath = join(skillDir, "SKILL.md")
  writeFileSync(skillPath, content)
  return skillPath
}

describe("formatPluginSkillsAsXmlItems", () => {
  it("should return empty string for no skills", () => {
    expect(formatPluginSkillsAsXmlItems([], "/plugin")).toBe("")
  })

  it("should format skills without wrapping <available_skills> tags", () => {
    const skills: LoadedSkill[] = [
      { name: "tdd", description: "Apply TDD", path: "/p/SKILL.md", body: "" },
    ]

    const result = formatPluginSkillsAsXmlItems(skills, "/plugin")

    expect(result).toContain("<skill>")
    expect(result).toContain("<name>tdd</name>")
    expect(result).toContain("<description>Apply TDD</description>")
    expect(result).not.toContain("<available_skills>")
  })

  it("should format multiple skills", () => {
    const skills: LoadedSkill[] = [
      { name: "a", description: "A", path: "/a", body: "" },
      { name: "b", description: "B", path: "/b", body: "" },
    ]

    const result = formatPluginSkillsAsXmlItems(skills, "/plugin")

    expect(result).toContain("<name>a</name>")
    expect(result).toContain("<name>b</name>")
  })
})

describe("discoverAllSkills", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should return empty array when no skills and no plugin skills", () => {
    const result = discoverAllSkills({
      pluginSkills: [],
      pluginDir: "/plugin",
      cwd: testDir,
    })
    expect(result).toEqual([])
  })

  it("should include plugin skills with scope=plugin", () => {
    const pluginSkills: LoadedSkill[] = [
      { name: "tdd", description: "TDD", path: "/plugin/skill/tdd/SKILL.md", body: "" },
    ]

    const result = discoverAllSkills({
      pluginSkills,
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("tdd")
    expect(result[0].scope).toBe("plugin")
  })

  it("should discover .opencode/skills/ in cwd", () => {
    const opencodeDir = join(testDir, ".opencode", "skills")
    mkdirSync(opencodeDir, { recursive: true })
    createSkillFile(opencodeDir, "project-skill", `---
name: project-skill
description: From project
---
Body`)

    const result = discoverAllSkills({
      pluginSkills: [],
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("project-skill")
    expect(result[0].scope).toBe("opencode-project")
  })

  it("should discover .claude/skills/ in cwd", () => {
    const claudeDir = join(testDir, ".claude", "skills")
    mkdirSync(claudeDir, { recursive: true })
    createSkillFile(claudeDir, "claude-skill", `---
name: claude-skill
description: From claude
---
Body`)

    const result = discoverAllSkills({
      pluginSkills: [],
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(1)
    expect(result[0].scope).toBe("claude-project")
  })

  it("should let project skills override plugin skills with same name", () => {
    const pluginSkills: LoadedSkill[] = [
      { name: "shared", description: "Plugin version", path: "/p", body: "" },
    ]

    const opencodeDir = join(testDir, ".opencode", "skills")
    mkdirSync(opencodeDir, { recursive: true })
    createSkillFile(opencodeDir, "shared", `---
name: shared
description: Project version
---
Body`)

    const result = discoverAllSkills({
      pluginSkills,
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(1)
    expect(result[0].description).toBe("Project version")
    expect(result[0].scope).toBe("opencode-project")
  })

  it("should ignore directories without SKILL.md", () => {
    const opencodeDir = join(testDir, ".opencode", "skills")
    const incompleteDir = join(opencodeDir, "no-skill")
    mkdirSync(incompleteDir, { recursive: true })
    writeFileSync(join(incompleteDir, "README.md"), "not a skill")

    const result = discoverAllSkills({
      pluginSkills: [],
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(0)
  })

  it("should ignore skills missing name or description", () => {
    const opencodeDir = join(testDir, ".opencode", "skills")
    mkdirSync(opencodeDir, { recursive: true })
    createSkillFile(opencodeDir, "no-name", `---
description: no name
---
Body`)
    createSkillFile(opencodeDir, "no-desc", `---
name: no-desc
---
Body`)

    const result = discoverAllSkills({
      pluginSkills: [],
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(0)
  })

  it("should ignore hidden directories", () => {
    const opencodeDir = join(testDir, ".opencode", "skills")
    mkdirSync(opencodeDir, { recursive: true })
    createSkillFile(opencodeDir, ".hidden", `---
name: hidden
description: hidden skill
---
Body`)

    const result = discoverAllSkills({
      pluginSkills: [],
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(0)
  })

  it("should let opencode-project override claude-project with same name", () => {
    const claudeDir = join(testDir, ".claude", "skills")
    mkdirSync(claudeDir, { recursive: true })
    createSkillFile(claudeDir, "shared", `---
name: shared
description: Claude version
---
Body`)

    const opencodeDir = join(testDir, ".opencode", "skills")
    mkdirSync(opencodeDir, { recursive: true })
    createSkillFile(opencodeDir, "shared", `---
name: shared
description: Opencode version
---
Body`)

    const result = discoverAllSkills({
      pluginSkills: [],
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(1)
    expect(result[0].description).toBe("Opencode version")
    expect(result[0].scope).toBe("opencode-project")
  })

  it("should aggregate multiple sources", () => {
    const pluginSkills: LoadedSkill[] = [
      { name: "plugin-only", description: "P", path: "/p", body: "" },
    ]

    const opencodeDir = join(testDir, ".opencode", "skills")
    mkdirSync(opencodeDir, { recursive: true })
    createSkillFile(opencodeDir, "opencode-only", `---
name: opencode-only
description: O
---
Body`)

    const claudeDir = join(testDir, ".claude", "skills")
    mkdirSync(claudeDir, { recursive: true })
    createSkillFile(claudeDir, "claude-only", `---
name: claude-only
description: C
---
Body`)

    const result = discoverAllSkills({
      pluginSkills,
      pluginDir: "/plugin",
      cwd: testDir,
    })

    expect(result).toHaveLength(3)
    const byName = new Map(result.map((s: SkillInfo) => [s.name, s]))
    expect(byName.get("plugin-only")?.scope).toBe("plugin")
    expect(byName.get("opencode-only")?.scope).toBe("opencode-project")
    expect(byName.get("claude-only")?.scope).toBe("claude-project")
  })
})
