import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  parseFrontmatter,
  loadAgents,
  loadSkills,
  loadCommands,
  loadHooks,
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

  it("should load agent with permissions and singular permission key", () => {
    const agentContent = `---
description: Permission agent
permission:
  bash: allow
---
Content`

    writeFileSync(join(testDir, "perm.md"), agentContent)

    const result = loadAgents(testDir)

    expect(result["perm"].permissions).toEqual({ bash: "allow" })
  })

  it("should prioritize permissions (plural) over permission (singular)", () => {
    const agentContent = `---
description: Dual permission agent
permission:
  bash: deny
permissions:
  bash: allow
---
Content`

    writeFileSync(join(testDir, "dual.md"), agentContent)

    const result = loadAgents(testDir)

    expect(result["dual"].permissions).toEqual({ bash: "allow" })
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

describe("loadHooks", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `opencode-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should return empty map for non-existent directory", () => {
    const result = loadHooks("/non/existent/path")
    expect(result.size).toBe(0)
  })

  it("should return empty map when hooks.md does not exist", () => {
    const result = loadHooks(testDir)
    expect(result.size).toBe(0)
  })

  it("should load hook from hooks.md with command action", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    condition: isMainSession
    actions:
      - command: simplify-changes
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    expect(result.has("session.idle")).toBe(true)

    const hooks = result.get("session.idle")!
    expect(hooks).toHaveLength(1)
    expect(hooks[0].event).toBe("session.idle")
    expect(hooks[0].condition).toBe("isMainSession")
    expect(hooks[0].actions).toHaveLength(1)
    expect(hooks[0].actions[0]).toEqual({ command: "simplify-changes" })
  })

  it("should load hook with hasCodeChange condition", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    condition: hasCodeChange
    actions:
      - command: simplify-changes
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.idle")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].condition).toBe("hasCodeChange")
  })

  it("should load hook with multiple actions", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    condition: isMainSession
    actions:
      - command: simplify-changes
      - skill: post-change-code-simplification
      - tool:
          name: bash
          args:
            command: "echo done"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.idle")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].actions).toHaveLength(3)
    expect(hooks[0].actions[0]).toEqual({ command: "simplify-changes" })
    expect(hooks[0].actions[1]).toEqual({ skill: "post-change-code-simplification" })
    expect(hooks[0].actions[2]).toEqual({ 
      tool: { name: "bash", args: { command: "echo done" } } 
    })
  })

  it("should load hook with command with args", () => {
    const hookContent = `---
hooks:
  - event: session.created
    actions:
      - command:
          name: review-pr
          args: "main feature"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.created")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].actions[0]).toEqual({ 
      command: { name: "review-pr", args: "main feature" } 
    })
  })

  it("should load hook without condition", () => {
    const hookContent = `---
hooks:
  - event: session.deleted
    actions:
      - command: test-cmd
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.deleted")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].condition).toBeUndefined()
  })

  it("should load multiple hooks for different events", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    actions:
      - command: simplify-changes
  - event: session.created
    actions:
      - command: init-cmd
  - event: tool.after.write
    actions:
      - command: after-write
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(3)
    expect(result.has("session.idle")).toBe(true)
    expect(result.has("session.created")).toBe(true)
    expect(result.has("tool.after.write")).toBe(true)
  })

  it("should load multiple hooks for same event in declaration order", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    condition: isMainSession
    actions:
      - command: first-cmd
  - event: session.idle
    actions:
      - command: second-cmd
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    const hooks = result.get("session.idle")!
    expect(hooks).toHaveLength(2)
    expect(hooks[0].condition).toBe("isMainSession")
    expect(hooks[0].actions[0]).toEqual({ command: "first-cmd" })
    expect(hooks[1].condition).toBeUndefined()
    expect(hooks[1].actions[0]).toEqual({ command: "second-cmd" })
  })

  it("should ignore hooks with invalid event names", () => {
    const hookContent = `---
hooks:
  - event: invalid.event
    actions:
      - command: test
  - event: session.idle
    actions:
      - command: valid-cmd
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    expect(result.has("session.idle")).toBe(true)
  })

  it("should return empty map with invalid YAML frontmatter", () => {
    const hookContent = `---
not valid yaml: : :
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(0)
  })

  it("should return empty map without hooks array", () => {
    const hookContent = `---
something: else
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(0)
  })

  it("should ignore hooks without actions array", () => {
    const hookContent = `---
hooks:
  - event: session.idle
  - event: session.created
    actions:
      - command: valid-cmd
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    expect(result.has("session.created")).toBe(true)
  })

  it("should support all valid event types", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    actions:
      - command: cmd1
  - event: session.created
    actions:
      - command: cmd2
  - event: session.deleted
    actions:
      - command: cmd3
  - event: tool.after.write
    actions:
      - command: cmd4
  - event: tool.after.edit
    actions:
      - command: cmd5
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(5)
    expect(result.has("session.idle")).toBe(true)
    expect(result.has("session.created")).toBe(true)
    expect(result.has("session.deleted")).toBe(true)
    expect(result.has("tool.after.write")).toBe(true)
    expect(result.has("tool.after.edit")).toBe(true)
  })
})

