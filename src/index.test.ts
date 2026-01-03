import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  parseFrontmatter,
  isCodeFile,
  loadAgents,
  loadSkills,
  loadCommands,
} from "./loaders"

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

    // Empty frontmatter returns empty object (yaml.load returns null, we cast to T)
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

describe("isCodeFile", () => {
  it("should return true for TypeScript files", () => {
    expect(isCodeFile("file.ts")).toBe(true)
    expect(isCodeFile("file.tsx")).toBe(true)
    expect(isCodeFile("/path/to/file.ts")).toBe(true)
  })

  it("should return true for JavaScript files", () => {
    expect(isCodeFile("file.js")).toBe(true)
    expect(isCodeFile("file.jsx")).toBe(true)
    expect(isCodeFile("file.mjs")).toBe(true)
    expect(isCodeFile("file.cjs")).toBe(true)
  })

  it("should return true for other code files", () => {
    expect(isCodeFile("file.py")).toBe(true)
    expect(isCodeFile("file.go")).toBe(true)
    expect(isCodeFile("file.rs")).toBe(true)
    expect(isCodeFile("file.java")).toBe(true)
    expect(isCodeFile("file.c")).toBe(true)
    expect(isCodeFile("file.cpp")).toBe(true)
  })

  it("should return true for config-as-code files", () => {
    expect(isCodeFile("config.yaml")).toBe(true)
    expect(isCodeFile("config.yml")).toBe(true)
    expect(isCodeFile("config.toml")).toBe(true)
  })

  it("should return false for non-code files", () => {
    expect(isCodeFile("file.md")).toBe(false)
    expect(isCodeFile("file.txt")).toBe(false)
    expect(isCodeFile("file.json")).toBe(false)
    expect(isCodeFile("file.html")).toBe(false)
    expect(isCodeFile("file.css")).toBe(false)
    expect(isCodeFile("image.png")).toBe(false)
  })

  it("should be case insensitive", () => {
    expect(isCodeFile("file.TS")).toBe(true)
    expect(isCodeFile("file.Tsx")).toBe(true)
    expect(isCodeFile("file.PY")).toBe(true)
  })
})

describe("loadAgents", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `opencode-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
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
tools:
  write: false
  edit: true
---

# Test Agent

You are a test agent.`

    writeFileSync(join(testDir, "test-agent.md"), agentContent)

    const result = loadAgents(testDir)

    expect(result["test-agent"]).toBeDefined()
    expect(result["test-agent"].description).toBe("Test agent")
    expect(result["test-agent"].mode).toBe("subagent")
    expect(result["test-agent"].temperature).toBe(0.5)
    expect(result["test-agent"].tools).toEqual({ write: false, edit: true })
    expect(result["test-agent"].prompt).toContain("You are a test agent.")
  })

  it("should convert agent mode to primary", () => {
    const agentContent = `---
description: Primary agent
mode: agent
---

Content`

    writeFileSync(join(testDir, "primary.md"), agentContent)

    const result = loadAgents(testDir)

    expect(result["primary"].mode).toBe("primary")
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
    testDir = join(tmpdir(), `opencode-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
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
})

describe("loadCommands", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `opencode-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
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
