import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "bun:test"
import { loadAgents } from "../loaders"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createKnowledgeTool } from "./knowledge"
import { createMemoryBackupTool } from "./memory-backup"
import { createTaskBoardTool } from "./task-board"

const directories: string[] = []
const writer = { agent: "memory-manager", sessionID: "ses_writer" }
const reviewer = { agent: "memory-reviewer", sessionID: "ses_review" }
const mutations = [
  { tool: "tasks", input: { action: "save", id: "T", expectedVersion: 2, description: "Unintended update." } },
  { tool: "tasks", input: { action: "edit", id: "T", expectedVersion: 2, edits: [{ oldText: "Current", newText: "Wrong" }] } },
  { tool: "tasks", input: { action: "restore", id: "T", expectedVersion: 2, restoreVersion: 1 } },
  { tool: "knowledge", input: { action: "save", id: "K", expectedVersion: 2, content: "Unintended update." } },
  { tool: "knowledge", input: { action: "edit", id: "K", expectedVersion: 2, edits: [{ oldText: "Current", newText: "Wrong" }] } },
  { tool: "knowledge", input: { action: "remove", id: "K", expectedVersion: 2 } },
  { tool: "knowledge", input: { action: "restore", id: "K", expectedVersion: 2, restoreVersion: 1 } },
  { tool: "backup", input: {} },
] as const

function fixture() {
  const directory = createTemporaryDirectory("froggy-memory-tools-")
  directories.push(directory)
  return { directory, knowledge: createKnowledgeTool(directory), tasks: createTaskBoardTool(directory), backup: createMemoryBackupTool(directory) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("memory search excerpts", () => {
  it("shows the matching passage instead of the start of a long note", async () => {
    const { knowledge } = fixture()
    await knowledge.execute({ action: "save", id: "K", title: "Build", topic: "build", content: "Unrelated introduction. ".repeat(100) + "Unique recovery marker: ceiling." }, writer)
    const result = await knowledge.execute({ action: "search", query: "ceiling" }, reviewer)
    expect(result.content).toContain("Unique recovery marker")
  })
})

describe("versioned content slices", () => {
  it("reconstructs Unicode knowledge without losing any characters", async () => {
    const { knowledge } = fixture()
    const content = "    😀\n".repeat(3_000) + "END\n"
    const saved = JSON.parse((await knowledge.execute({ action: "save", id: "K", title: "Large", topic: "build", content }, writer)).content)
    let reconstructed = ""
    for (let offset = 0; offset < Array.from(content).length; offset += 1_003) {
      const result = await knowledge.execute({ action: "get", id: "K", offset, limit: 1_003, version: saved.version }, reviewer)
      reconstructed += result.content.split("\n\n--- content ---\n")[1]
    }
    expect(reconstructed).toBe(content)
  })

  it("rejects a continuation when the knowledge version changed", async () => {
    const { knowledge } = fixture()
    const first = JSON.parse((await knowledge.execute({ action: "save", id: "K", title: "Note", topic: "build", content: "First content." }, writer)).content)
    await knowledge.execute({ action: "save", id: "K", content: "Second content.", expectedVersion: first.version }, writer)
    await expect(knowledge.execute({ action: "get", id: "K", offset: 5, limit: 5, version: first.version }, reviewer)).rejects.toThrow("changed")
  })

  it("requires a version for continuation reads", async () => {
    const { knowledge } = fixture()
    await knowledge.execute({ action: "save", id: "K", title: "Note", topic: "build", content: "Content." }, writer)
    await expect(knowledge.execute({ action: "get", id: "K", offset: 1, limit: 5 }, reviewer)).rejects.toThrow("version")
  })

  it("slices task descriptions without removing indentation", async () => {
    const { tasks } = fixture()
    await tasks.execute({ action: "save", id: "T", title: "Task", description: "    command\nnext\n" }, writer)
    const result = await tasks.execute({ action: "get", id: "T", offset: 0, limit: 12 }, reviewer)
    expect(result.content.split("\n\n--- content ---\n")[1]).toBe("    command\n")
  })

  it.each([-1, 0.5, "0", null])("rejects invalid offset %j", async (offset) => {
    await expect(fixture().knowledge.execute({ action: "get", id: "K", offset }, reviewer)).rejects.toThrow("offset")
  })
})

describe("history tools", () => {
  it("lets the memory manager restore a task", async () => {
    const { tasks } = fixture()
    const first = JSON.parse((await tasks.execute({ action: "save", id: "T", title: "Task", description: "Keep recovery references." }, writer)).content)
    const second = JSON.parse((await tasks.execute({ action: "save", id: "T", description: "Wrong.", expectedVersion: first.version }, writer)).content)
    const restored = JSON.parse((await tasks.execute({ action: "restore", id: "T", restoreVersion: first.version, expectedVersion: second.version }, writer)).content)
    expect(restored.version).toBeGreaterThan(second.version)
    expect((await tasks.execute({ action: "get", id: "T" }, reviewer)).content).toContain("Keep recovery references.")
  })

  it("restores a historical knowledge version through the writer", async () => {
    const { knowledge } = fixture()
    const first = JSON.parse((await knowledge.execute({ action: "save", id: "K", title: "Original", topic: "build", content: "Keep." }, writer)).content)
    const second = JSON.parse((await knowledge.execute({ action: "save", id: "K", content: "Wrong.", expectedVersion: first.version }, writer)).content)
    await knowledge.execute({ action: "restore", id: "K", restoreVersion: first.version, expectedVersion: second.version }, writer)
    expect((await knowledge.execute({ action: "get", id: "K" }, reviewer)).content).toContain("Keep.")
  })

  it("lets readers inspect a saved version after removal", async () => {
    const { knowledge } = fixture()
    const saved = JSON.parse((await knowledge.execute({ action: "save", id: "K", title: "Original", topic: "build", content: "Recovery evidence." }, writer)).content)
    await knowledge.execute({ action: "remove", id: "K", expectedVersion: saved.version }, writer)
    expect((await knowledge.execute({ action: "history", id: "K", version: saved.version }, reviewer)).content).toContain("Recovery evidence.")
  })

  it("rejects restoring without a current version", async () => {
    await expect(fixture().knowledge.execute({ action: "restore", id: "K", restoreVersion: 1 }, writer)).rejects.toThrow("expectedVersion")
  })

  it.each(["knowledge", "tasks"] as const)("validates the %s restore target before creating a store", async (name) => {
    const state = fixture()
    await expect(state[name].execute({ action: "restore", id: "K", restoreVersion: 0, expectedVersion: 1 }, writer)).rejects.toThrow("restoreVersion")
    expect(existsSync(join(state.directory, ".opencode"))).toBe(false)
  })

  it("restores removed knowledge using a fresh removal receipt", async () => {
    const { knowledge } = fixture()
    const saved = JSON.parse((await knowledge.execute({ action: "save", id: "K", title: "Note", topic: "build", content: "Keep." }, writer)).content)
    const removed = JSON.parse((await knowledge.execute({ action: "remove", id: "K", expectedVersion: saved.version }, writer)).content)
    expect(removed.version).toBeGreaterThan(saved.version)
    await knowledge.execute({ action: "restore", id: "K", restoreVersion: saved.version, expectedVersion: removed.version }, writer)
    expect((await knowledge.execute({ action: "get", id: "K" }, reviewer)).content).toContain("Keep.")
  })
})

describe("read-only audit identity", () => {
  it.each(["shell", "edit", "execute", "subagent", "memory-backup", "agent-promote"])("denies %s to the audit agent", (action) => {
    const agent = loadAgents(fileURLToPath(new URL("../../agent/", import.meta.url)))["memory-reviewer"]
    const rules = agent.permissions
    if (!Array.isArray(rules)) throw new Error("Expected ordered permission rules")
    const rule = [...rules].reverse().find((item) => item.action === action || item.action === "*")
    expect(rule?.effect).toBe("deny")
  })
})

describe.each(["orchestrator", "build", "general", "code-reviewer", "memory-reviewer", "product-owner"])("memory write permissions for %s", (agent) => {
  const caller = { agent, sessionID: "ses_caller" }

  it.each(mutations)("rejects %j without creating a store", async ({ tool, input }) => {
    const state = fixture()
    await expect(state[tool].execute(input, caller)).rejects.toThrow("Only")
    expect(existsSync(join(state.directory, ".opencode"))).toBe(false)
  })

  it.each(mutations)("rejects %j without changing existing memory or backups", async ({ tool, input }) => {
    const state = fixture()
    await state.tasks.execute({ action: "save", id: "T", title: "Task", description: "Original scope." }, writer)
    await state.tasks.execute({ action: "save", id: "T", expectedVersion: 1, description: "Current scope." }, writer)
    await state.knowledge.execute({ action: "save", id: "K", title: "Note", topic: "build", content: "Original finding." }, writer)
    await state.knowledge.execute({ action: "save", id: "K", expectedVersion: 1, content: "Current finding." }, writer)
    const directory = join(state.directory, ".opencode", "memory")
    const files = readdirSync(directory)
    const contents = files.map((file) => readFileSync(join(directory, file)))

    await expect(state[tool].execute(input, caller)).rejects.toThrow("Only")

    expect(readdirSync(directory)).toEqual(files)
    expect(files.map((file) => readFileSync(join(directory, file)))).toEqual(contents)
  })
})

describe("backup tool", () => {
  it("creates a verified backup through the memory manager", async () => {
    const { knowledge, backup } = fixture()
    await knowledge.execute({ action: "save", id: "K", title: "Note", topic: "build", content: "Keep." }, writer)
    const receipt = JSON.parse((await backup.execute({}, writer)).content)
    expect(existsSync(receipt.path)).toBe(true)
    expect(receipt.bytes).toBeGreaterThan(0)
  })

  it("does not create a missing database", async () => {
    const { directory, backup } = fixture()
    await expect(backup.execute({}, writer)).rejects.toThrow("No project memory database")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })

  it("rejects caller-selected backup destinations", async () => {
    await expect(fixture().backup.execute({ path: "/outside" }, writer)).rejects.toThrow("Unsupported memory parameter")
  })
})
