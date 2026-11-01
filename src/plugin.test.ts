import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, jest, mock } from "bun:test"
import { Agent, type Plugin } from "@opencode/plugin"
import plugin from "./index"
import { createTemporaryDirectory } from "./test-fixtures/temporary-directory"

type AgentEditor = Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]
type AgentDraft = Parameters<Parameters<AgentEditor["update"]>[1]>[0]
type SkillEditor = Parameters<Parameters<Plugin.Context["skill"]["transform"]>[0]>[0]
type RegisteredTool = {
  name: string
  execute(input: unknown, context: unknown): Promise<{ content: string }>
}
type SessionEvent = { type: string; data: { sessionID: string; parentID?: string; title?: string } }
type ContextDraft = { system: { type: "text"; text: string }[] }

const originalConfigHome = process.env.XDG_CONFIG_HOME
const directories: string[] = []
const cleanups: Plugin.Cleanup[] = []

function fixture(events: SessionEvent[] = []) {
  const directory = createTemporaryDirectory("froggy-plugin-")
  directories.push(directory)
  process.env.XDG_CONFIG_HOME = join(directory, "config")
  const tools = new Map<string, RegisteredTool>()
  const agents = new Map<string, AgentDraft>()
  const skills: string[] = []
  const sessionHooks = new Map<string, (event: ContextDraft) => void>()
  const registration = { dispose: async () => {} }
  const toolHook = mock(async () => registration)
  const command = mock(async () => {})
  const remove = mock(async (_key: string) => {})
  let finishEvents!: () => void
  const eventsFinished = new Promise<void>((resolve) => { finishEvents = resolve })
  const context = {
    location: { directory, project: { id: "project-test", canonical: directory } },
    agent: {
      transform: async (transform: (editor: Pick<AgentEditor, "update" | "remove">) => void) => {
        transform({
          update: (name, update) => {
            const agent = agents.get(name) ?? structuredClone(Agent.Info.default(Agent.ID.make(name)))
            update(agent)
            agents.set(name, agent)
          },
          remove: (name) => { agents.delete(name) },
        })
        return registration
      },
      reload: async () => {},
    },
    command: { reload: async () => {} },
    skill: {
      transform: async (transform: (editor: Pick<SkillEditor, "add">) => void) => {
        transform({ add: (skill) => { skills.push(skill.id) } })
        return registration
      },
    },
    tool: {
      transform: async (transform: (editor: { add(tool: RegisteredTool): void }) => void) => {
        transform({ add: (tool) => { tools.set(tool.name, tool) } })
        return registration
      },
      hook: toolHook,
    },
    session: {
      get: async () => { throw Object.assign(new Error("Session removed"), { _tag: "SessionNotFoundError" }) },
      command,
      hook: async (name: string, callback: (event: ContextDraft) => void) => {
        sessionHooks.set(name, callback)
        return registration
      },
    },
    storage: { scan: async () => ({ entries: [] }), remove },
    event: {
      async *subscribe() {
        for (const event of events) yield event
        finishEvents()
      },
    },
  }
  return {
    directory, tools, agents, skills, sessionHooks, toolHook, command, remove, eventsFinished,
    async start() {
      const cleanup = await plugin.setup(context as unknown as Plugin.Context)
      if (cleanup) cleanups.push(cleanup)
    },
  }
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalConfigHome
  jest.restoreAllMocks()
})

describe("plugin setup", () => {
  it("registers only the core and general utility tools", async () => {
    const state = fixture()
    await state.start()
    expect([...state.tools.keys()].sort()).toEqual([
      "agent-promote", "gitingest", "knowledge", "list-child-sessions", "memory-overview",
      "memory-review", "orchestrator-status", "pdf-to-markdown", "session-context",
      "start-orchestrator-loop", "stop-orchestrator-loop", "task-board",
    ])
  })

  it("does not register the removed tool automation hooks", async () => {
    const state = fixture()
    await state.start()
    expect(state.toolHook).not.toHaveBeenCalled()
  })

  it.each(["global", "project"] as const)("ignores legacy %s hook configuration", async (scope) => {
    const state = fixture([{ type: "session.idle", data: { sessionID: "ses-root" } }])
    const hookDirectory = scope === "global"
      ? join(state.directory, "config", "opencode", "hook")
      : join(state.directory, ".opencode", "hook")
    mkdirSync(hookDirectory, { recursive: true })
    writeFileSync(join(hookDirectory, "hooks.md"), `---
hooks:
  - event: session.idle
    actions:
      - command: legacy-hook
---
`)
    await state.start()
    await state.eventsFinished
    expect(state.command).not.toHaveBeenCalled()
  })

  it("keeps the bundled agents and skills available", async () => {
    const state = fixture()
    await state.start()
    expect(state.agents.get("orchestrator")?.mode).toBe("primary")
    expect(state.agents.get("memory-manager")?.mode).toBe("subagent")
    expect(state.skills).toContain("tdd")
  })

  it("keeps the native context hook for skill activation", async () => {
    const state = fixture()
    await state.start()
    const event: ContextDraft = { system: [] }
    const hook = state.sessionHooks.get("context")
    expect(hook).toBeDefined()
    hook!(event)
    expect(event.system.some((part) => part.text.includes("MANDATORY: Call skill"))).toBe(true)
  })

  it("keeps registered project knowledge tools functional", async () => {
    const state = fixture()
    await state.start()
    const tool = state.tools.get("knowledge")!
    await tool.execute({
      action: "save", id: "scope", topic: "architecture", title: "Core scope",
      content: "Keep orchestration, memory and general utilities.",
    }, { agent: "memory-manager", sessionID: "ses-memory-manager" })
    const result = await tool.execute({ action: "get", id: "scope" }, {})
    expect(result.content).toContain("Keep orchestration, memory and general utilities.")
  })

  it("ignores child creation events", async () => {
    const state = fixture([{ type: "session.created", data: { sessionID: "ses-child", parentID: "ses-root" } }])
    await state.start()
    await state.eventsFinished
    expect(state.remove).not.toHaveBeenCalled()
  })

  it("still clears coordination state for a deleted session", async () => {
    const state = fixture([{ type: "session.deleted", data: { sessionID: "ses-child" } }])
    await state.start()
    await state.eventsFinished
    expect(state.remove).toHaveBeenCalledWith("orchestrator-loop/ses-child")
    expect(state.remove).toHaveBeenCalledWith("orchestrator-diagnostics/ses-child")
  })
})
