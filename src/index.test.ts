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
  mergeHooks,
  type HookConfig,
  type HookEvent,
} from "./loaders"
import { executeBashAction, type BashContext } from "./bash-executor"

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

  it("should use mode value directly (primary, subagent, all)", () => {
    const primaryContent = `---
description: Primary agent
mode: primary
---

Content`

    const subagentContent = `---
description: Subagent
mode: subagent
---

Content`

    const allContent = `---
description: All modes agent
mode: all
---

Content`

    const noModeContent = `---
description: No mode specified
---

Content`

    writeFileSync(join(testDir, "primary.md"), primaryContent)
    writeFileSync(join(testDir, "subagent.md"), subagentContent)
    writeFileSync(join(testDir, "all.md"), allContent)
    writeFileSync(join(testDir, "nomode.md"), noModeContent)

    const result = loadAgents(testDir)

    expect(result["primary"].mode).toBe("primary")
    expect(result["subagent"].mode).toBe("subagent")
    expect(result["all"].mode).toBe("all")
    expect(result["nomode"].mode).toBe("all")
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
    conditions: [isMainSession]
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
    expect(hooks[0].conditions).toEqual(["isMainSession"])
    expect(hooks[0].actions).toHaveLength(1)
    expect(hooks[0].actions[0]).toEqual({ command: "simplify-changes" })
  })

  it("should load hook with hasCodeChange condition", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    conditions: [hasCodeChange]
    actions:
      - command: simplify-changes


---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.idle")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].conditions).toEqual(["hasCodeChange"])
  })


  it("should load hook with multiple actions", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    conditions: [isMainSession]
    actions:
      - command: simplify-changes
      - tool:
          name: bash
          args:
            command: "echo done"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.idle")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].actions).toHaveLength(2)
    expect(hooks[0].actions[0]).toEqual({ command: "simplify-changes" })
    expect(hooks[0].actions[1]).toEqual({ 
      tool: { name: "bash", args: { command: "echo done" } } 
    })
  })

  it("should load hook with bash action (short form)", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    actions:
      - bash: "npm run lint"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.idle")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].actions).toHaveLength(1)
    expect(hooks[0].actions[0]).toEqual({ bash: "npm run lint" })
  })

  it("should load hook with bash action (long form with timeout)", () => {
    const hookContent = `---
hooks:
  - event: session.created
    actions:
      - bash:
          command: "$OPENCODE_PROJECT_DIR/.opencode/hooks/init.sh"
          timeout: 30000
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.created")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].actions[0]).toEqual({
      bash: {
        command: "$OPENCODE_PROJECT_DIR/.opencode/hooks/init.sh",
        timeout: 30000,
      },
    })
  })

  it("should load hook with mixed actions including bash", () => {
    const hookContent = `---
hooks:
  - event: session.idle
    conditions: [hasCodeChange]
    actions:
      - bash: "npm run lint"
      - command: simplify-changes
      - bash:
          command: "npm run format"
          timeout: 10000
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)
    const hooks = result.get("session.idle")!

    expect(hooks).toHaveLength(1)
    expect(hooks[0].actions).toHaveLength(3)
    expect(hooks[0].actions[0]).toEqual({ bash: "npm run lint" })
    expect(hooks[0].actions[1]).toEqual({ command: "simplify-changes" })
    expect(hooks[0].actions[2]).toEqual({
      bash: { command: "npm run format", timeout: 10000 },
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

  it("should load hook without conditions", () => {
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
    expect(hooks[0].conditions).toBeUndefined()
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
    conditions: [isMainSession]
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
    expect(hooks[0].conditions).toEqual(["isMainSession"])
    expect(hooks[0].actions[0]).toEqual({ command: "first-cmd" })
    expect(hooks[1].conditions).toBeUndefined()
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

  it("should support tool.before.* wildcard event", () => {
    const hookContent = `---
hooks:
  - event: tool.before.*
    actions:
      - bash: "echo before all tools"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    expect(result.has("tool.before.*")).toBe(true)
    expect(result.get("tool.before.*")![0].actions[0]).toEqual({ bash: "echo before all tools" })
  })

  it("should support tool.after.* wildcard event", () => {
    const hookContent = `---
hooks:
  - event: tool.after.*
    actions:
      - bash: "echo after all tools"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    expect(result.has("tool.after.*")).toBe(true)
  })

  it("should support tool.before.<name> specific events", () => {
    const hookContent = `---
hooks:
  - event: tool.before.write
    actions:
      - bash: "echo before write"
  - event: tool.before.edit
    actions:
      - bash: "echo before edit"
  - event: tool.before.bash
    actions:
      - bash: "echo before bash"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(3)
    expect(result.has("tool.before.write")).toBe(true)
    expect(result.has("tool.before.edit")).toBe(true)
    expect(result.has("tool.before.bash")).toBe(true)
  })

  it("should support mixed wildcard and specific tool events", () => {
    const hookContent = `---
hooks:
  - event: tool.before.*
    actions:
      - bash: "echo before all"
  - event: tool.before.write
    actions:
      - bash: "echo before write specifically"
  - event: tool.after.*
    actions:
      - bash: "echo after all"
  - event: tool.after.write
    actions:
      - bash: "echo after write specifically"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(4)
    expect(result.has("tool.before.*")).toBe(true)
    expect(result.has("tool.before.write")).toBe(true)
    expect(result.has("tool.after.*")).toBe(true)
    expect(result.has("tool.after.write")).toBe(true)
  })

  it("should reject tool.before without suffix", () => {
    const hookContent = `---
hooks:
  - event: tool.before
    actions:
      - bash: "echo invalid"
  - event: tool.before.write
    actions:
      - bash: "echo valid"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    expect(result.has("tool.before" as HookEvent)).toBe(false)
    expect(result.has("tool.before.write")).toBe(true)
  })

  it("should reject tool.after without suffix", () => {
    const hookContent = `---
hooks:
  - event: tool.after
    actions:
      - bash: "echo invalid"
  - event: session.idle
    actions:
      - bash: "echo valid"
---`

    writeFileSync(join(testDir, "hooks.md"), hookContent)

    const result = loadHooks(testDir)

    expect(result.size).toBe(1)
    expect(result.has("tool.after" as HookEvent)).toBe(false)
    expect(result.has("session.idle")).toBe(true)
  })
})

describe("executeBashAction", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `opencode-bash-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should execute simple command and return stdout", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("echo hello", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("hello")
    expect(result.stderr).toBe("")
  })

  it("should return exit code 1 for failing command", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("exit 1", 5000, context, testDir)

    expect(result.exitCode).toBe(1)
  })

  it("should return exit code 2 for blocking command", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("echo 'blocked' >&2 && exit 2", 5000, context, testDir)

    expect(result.exitCode).toBe(2)
    expect(result.stderr.trim()).toBe("blocked")
  })

  it("should capture stderr", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("echo 'error message' >&2", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("error message")
  })

  it("should set OPENCODE_PROJECT_DIR environment variable", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("echo $OPENCODE_PROJECT_DIR", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe(testDir)
  })

  it("should set OPENCODE_SESSION_ID environment variable", async () => {
    const context: BashContext = {
      session_id: "my-session-123",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("echo $OPENCODE_SESSION_ID", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("my-session-123")
  })

  it("should pass context as JSON via stdin", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
      files: ["file1.ts", "file2.ts"],
    }

    const result = await executeBashAction("cat", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.session_id).toBe("test-session")
    expect(parsed.event).toBe("session.idle")
    expect(parsed.files).toEqual(["file1.ts", "file2.ts"])
  })

  it("should timeout long-running commands", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("sleep 10", 100, context, testDir)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("timed out")
  })

  it("should run command in specified cwd", async () => {
    const subDir = join(testDir, "subdir")
    mkdirSync(subDir)

    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: subDir,
    }

    const result = await executeBashAction("pwd", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    // macOS resolves /var to /private/var, so we check if the path ends with the subdir
    expect(result.stdout.trim()).toContain("subdir")
  })

  it("should handle command with special characters", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("echo 'hello world' && echo \"test\"", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello world")
    expect(result.stdout).toContain("test")
  })

  it("should pass tool_name and tool_args via stdin for tool hooks", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "tool.before.write",
      cwd: testDir,
      tool_name: "write",
      tool_args: { filePath: "/path/to/file.ts", content: "hello" },
    }

    const result = await executeBashAction("cat", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.tool_name).toBe("write")
    expect(parsed.tool_args).toEqual({ filePath: "/path/to/file.ts", content: "hello" })
    expect(parsed.event).toBe("tool.before.write")
  })

  it("should not include tool fields when not provided", async () => {
    const context: BashContext = {
      session_id: "test-session",
      event: "session.idle",
      cwd: testDir,
    }

    const result = await executeBashAction("cat", 5000, context, testDir)

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.tool_name).toBeUndefined()
    expect(parsed.tool_args).toBeUndefined()
  })
})

describe("mergeHooks", () => {
  it("should return empty map when merging empty maps", () => {
    const result = mergeHooks(
      new Map<HookEvent, HookConfig[]>(),
      new Map<HookEvent, HookConfig[]>()
    )
    expect(result.size).toBe(0)
  })

  it("should merge maps with non-overlapping events", () => {
    const hook1: HookConfig = { event: "session.idle", actions: [{ command: "cmd1" }] }
    const hook2: HookConfig = { event: "session.created", actions: [{ command: "cmd2" }] }

    const map1 = new Map<HookEvent, HookConfig[]>([["session.idle", [hook1]]])
    const map2 = new Map<HookEvent, HookConfig[]>([["session.created", [hook2]]])

    const result = mergeHooks(map1, map2)

    expect(result.size).toBe(2)
    expect(result.has("session.idle")).toBe(true)
    expect(result.has("session.created")).toBe(true)
  })

  it("should concatenate hooks for overlapping events in order", () => {
    const hook1: HookConfig = { event: "session.idle", actions: [{ command: "cmd1" }] }
    const hook2: HookConfig = { event: "session.idle", actions: [{ command: "cmd2" }] }

    const map1 = new Map<HookEvent, HookConfig[]>([["session.idle", [hook1]]])
    const map2 = new Map<HookEvent, HookConfig[]>([["session.idle", [hook2]]])

    const result = mergeHooks(map1, map2)

    expect(result.size).toBe(1)
    const hooks = result.get("session.idle")!
    expect(hooks).toHaveLength(2)
    expect(hooks[0]).toBe(hook1)
    expect(hooks[1]).toBe(hook2)
  })

  it("should handle single map input", () => {
    const hook: HookConfig = { event: "session.idle", actions: [{ command: "cmd" }] }
    const map = new Map<HookEvent, HookConfig[]>([["session.idle", [hook]]])

    const result = mergeHooks(map)

    expect(result.size).toBe(1)
    expect(result.get("session.idle")).toHaveLength(1)
  })

  it("should handle multiple maps with multiple events each", () => {
    const globalHook1: HookConfig = { event: "session.idle", actions: [{ command: "global-idle" }] }
    const globalHook2: HookConfig = { event: "session.created", actions: [{ command: "global-created" }] }
    const projectHook1: HookConfig = { event: "session.idle", actions: [{ command: "project-idle" }] }
    const projectHook2: HookConfig = { event: "session.deleted", actions: [{ command: "project-deleted" }] }

    const globalMap = new Map<HookEvent, HookConfig[]>([
      ["session.idle", [globalHook1]],
      ["session.created", [globalHook2]],
    ])
    const projectMap = new Map<HookEvent, HookConfig[]>([
      ["session.idle", [projectHook1]],
      ["session.deleted", [projectHook2]],
    ])

    const result = mergeHooks(globalMap, projectMap)

    expect(result.size).toBe(3)
    expect(result.get("session.idle")).toHaveLength(2)
    expect(result.get("session.idle")![0]).toBe(globalHook1)
    expect(result.get("session.idle")![1]).toBe(projectHook1)
    expect(result.get("session.created")).toHaveLength(1)
    expect(result.get("session.deleted")).toHaveLength(1)
  })
})

