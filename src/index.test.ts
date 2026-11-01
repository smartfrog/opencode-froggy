import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  parseFrontmatter,
  loadAgents,
  loadSkills,
  loadCommands,
  type LoadedSkill,
} from "./loaders"
import { buildSkillActivationBlock } from "./skill-activation"
import { createTemporaryDirectory } from "./test-fixtures/temporary-directory"

describe("parseFrontmatter", () => {
  it("should parse valid frontmatter", () => {
    const content = `---
name: test
description: A test skill
---

# Content here`

    const result = parseFrontmatter<{ name: string; description: string }>(content)

    expect(result.data.name).toBe("test")
    expect(result.data.description).toBe("A test skill")
    expect(result.body.trim()).toBe("# Content here")
  })

  it("should handle content without frontmatter", () => {
    const content = "# Just content\n\nNo frontmatter here"

    const result = parseFrontmatter<{ name?: string }>(content)

    expect(result.data).toEqual({})
    expect(result.body).toBe(content)
  })

  it("should handle empty frontmatter", () => {
    const content = `---
---

Content after empty frontmatter`

    const result = parseFrontmatter<{ name?: string }>(content)

    expect(result.data).toEqual({})
    expect(result.body.trim()).toBe("Content after empty frontmatter")
  })

  it("should handle invalid YAML gracefully", () => {
    const content = `---
invalid: yaml: content: here
---

Body content`

    const result = parseFrontmatter<{ invalid?: string }>(content)

    expect(result.data).toEqual({})
    expect(result.body).toBe(content)
  })
})

describe("loadAgents", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTemporaryDirectory("froggy-agents-")
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should return empty object for non-existent directory", () => {
    const result = loadAgents("/non/existent/path")
    expect(result).toEqual({})
  })

  it("should load agent from markdown file", () => {
    const agentContent = `---
description: Test agent
mode: subagent
temperature: 0.5
permissions:
  - action: edit
    resource: "*"
    effect: deny
---

# Test Agent

You are a test agent.`

    writeFileSync(join(testDir, "test-agent.md"), agentContent)

    const result = loadAgents(testDir)

    expect(result["test-agent"]).toBeDefined()
    expect(result["test-agent"].description).toBe("Test agent")
    expect(result["test-agent"].mode).toBe("subagent")
    expect(result["test-agent"].temperature).toBe(0.5)
    expect(result["test-agent"].permissions).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
    expect(result["test-agent"].prompt).toContain("You are a test agent.")
  })

  it.each(["permission", "tools"])("rejects the legacy %s field rather than dropping restrictions", (field) => {
    const agentContent = `---
description: Permission agent
${field}:
  bash: allow
---
Content`

    writeFileSync(join(testDir, "perm.md"), agentContent)

    expect(() => loadAgents(testDir)).toThrow("Unsupported legacy agent field")
  })

  it("rejects legacy fields even when V2 permissions are present", () => {
    const agentContent = `---
description: Dual permission agent
permission:
  bash: deny
permissions:
  - action: shell
    resource: "*"
    effect: allow
---
Content`

    writeFileSync(join(testDir, "dual.md"), agentContent)

    expect(() => loadAgents(testDir)).toThrow("Unsupported legacy agent field")
  })

  it("should not include undefined optional fields", () => {
    const agentContent = `---
description: Minimal agent
---
Content`

    writeFileSync(join(testDir, "minimal.md"), agentContent)

    const result = loadAgents(testDir)

    expect(result["minimal"]).not.toHaveProperty("temperature")
    expect(result["minimal"]).not.toHaveProperty("tools")
    expect(result["minimal"]).not.toHaveProperty("permissions")
  })

  it.each([
    ["primary", "primary"],
    ["subagent", "subagent"],
    ["all", "all"],
    [undefined, "all"],
  ] as const)("loads mode %s as %s", (mode, expected) => {
    const field = mode === undefined ? "" : `mode: ${mode}\n`
    writeFileSync(join(testDir, "agent.md"), `---\ndescription: Agent\n${field}---\nContent`)

    expect(loadAgents(testDir).agent.mode).toBe(expected)
  })

  it("should ignore non-markdown files", () => {
    writeFileSync(join(testDir, "not-agent.txt"), "some content")
    writeFileSync(join(testDir, "agent.md"), "---\ndescription: Agent\n---\nContent")

    const result = loadAgents(testDir)

    expect(Object.keys(result)).toEqual(["agent"])
  })
})

describe("loadSkills", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTemporaryDirectory("froggy-skills-")
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should return empty array for non-existent directory", () => {
    const result = loadSkills("/non/existent/path")
    expect(result).toEqual([])
  })

  it("should load skill from SKILL.md in subdirectory", () => {
    const skillDir = join(testDir, "my-skill")
    mkdirSync(skillDir)

    const skillContent = `---
name: my-skill
description: A test skill
---

# Skill Instructions

Do something useful.`

    writeFileSync(join(skillDir, "SKILL.md"), skillContent)

    const result = loadSkills(testDir)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("my-skill")
    expect(result[0].description).toBe("A test skill")
    expect(result[0].body).toContain("Do something useful.")
    expect(result[0].path).toBe(join(skillDir, "SKILL.md"))
  })

  it("should use directory name if name not in frontmatter", () => {
    const skillDir = join(testDir, "fallback-name")
    mkdirSync(skillDir)

    const skillContent = `---
description: No name provided
---

Content`

    writeFileSync(join(skillDir, "SKILL.md"), skillContent)

    const result = loadSkills(testDir)

    expect(result[0].name).toBe("fallback-name")
  })

  it("should ignore directories without SKILL.md", () => {
    const skillDir1 = join(testDir, "valid-skill")
    const skillDir2 = join(testDir, "invalid-skill")
    mkdirSync(skillDir1)
    mkdirSync(skillDir2)

    writeFileSync(join(skillDir1, "SKILL.md"), "---\nname: valid\n---\nContent")
    writeFileSync(join(skillDir2, "README.md"), "Not a skill")

    const result = loadSkills(testDir)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("valid")
  })

  it.each(["After completing a task, call this skill", undefined])("loads optional use_when %s", (trigger) => {
    const skillDir = join(testDir, "auto-skill")
    mkdirSync(skillDir)
    const field = trigger === undefined ? "" : `use_when: ${trigger}\n`
    writeFileSync(join(skillDir, "SKILL.md"), `---\nname: auto-skill\n${field}---\nSkill instructions here.`)

    const result = loadSkills(testDir)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("auto-skill")
    expect(result[0].useWhen).toBe(trigger)
  })
})

describe("loadCommands", () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTemporaryDirectory("froggy-commands-")
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should return empty object for non-existent directory", () => {
    const result = loadCommands("/non/existent/path")
    expect(result).toEqual({})
  })

  it("should load command from markdown file", () => {
    const commandContent = `---
description: Test command
agent: code-reviewer
---

## Context

Run this command to test.`

    writeFileSync(join(testDir, "test-cmd.md"), commandContent)

    const result = loadCommands(testDir)

    expect(result["test-cmd"]).toBeDefined()
    expect(result["test-cmd"].description).toBe("Test command")
    expect(result["test-cmd"].agent).toBe("code-reviewer")
    expect(result["test-cmd"].template).toContain("Run this command to test.")
  })

  it("should handle command without agent", () => {
    const commandContent = `---
description: Simple command
---

Do something`

    writeFileSync(join(testDir, "simple.md"), commandContent)

    const result = loadCommands(testDir)

    expect(result["simple"].agent).toBeUndefined()
  })
})

describe("buildSkillActivationBlock", () => {
  it("should return empty string for undefined input", () => {
    const result = buildSkillActivationBlock(undefined as unknown as LoadedSkill[])
    expect(result).toBe("")
  })

  it("should return empty string for empty array", () => {
    const result = buildSkillActivationBlock([])
    expect(result).toBe("")
  })

  it("should generate imperative instruction with skill name", () => {
    const skills: LoadedSkill[] = [
      {
        name: "code-review",
        description: "Review code",
        useWhen: "After writing code",
        path: "/path/to/skill",
        body: "",
      },
    ]

    const result = buildSkillActivationBlock(skills)

    expect(result).toContain("MANDATORY")
    expect(result).toContain('skill({ id: "code-review" })')
    expect(result).toContain("After writing code")
  })

  it.each([
    ["quotes", 'Call when user says "help"', 'Call when user says "help"'],
    ["internal whitespace", "First line\nSecond line\nThird line", "First line Second line Third line"],
    ["surrounding whitespace", "  padded trigger  ", "padded trigger"],
  ])("normalizes trigger %s", (_name, useWhen, expected) => {
    const skill: LoadedSkill = { name: "test-skill", description: "Test", useWhen, path: "/path", body: "" }

    expect(buildSkillActivationBlock([skill])).toBe(`MANDATORY: Call skill({ id: "test-skill" }) ${expected}`)
  })

  it("should generate separate instructions for multiple skills", () => {
    const skills: LoadedSkill[] = [
      { name: "skill-a", description: "A", useWhen: "Trigger A", path: "/a", body: "" },
      { name: "skill-b", description: "B", useWhen: "Trigger B", path: "/b", body: "" },
    ]

    const result = buildSkillActivationBlock(skills)

    expect(result).toContain('skill({ id: "skill-a" })')
    expect(result).toContain('skill({ id: "skill-b" })')
    expect(result).toContain("Trigger A")
    expect(result).toContain("Trigger B")
    expect(result.match(/MANDATORY/g)).toHaveLength(2)
  })
})
