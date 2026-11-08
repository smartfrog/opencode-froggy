import { existsSync, rmSync } from "node:fs"
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

  it.each(["save", "remove", "restore"])("blocks knowledge %s even when requested by the audit", async (action) => {
    await expect(fixture().knowledge.execute({ action, id: "K", expectedVersion: 1, restoreVersion: 1 }, reviewer)).rejects.toThrow("Only memory-manager")
  })

  it.each(["save", "restore"])("blocks task %s even when requested by the audit", async (action) => {
    await expect(fixture().tasks.execute({ action, id: "T", expectedVersion: 1, restoreVersion: 1 }, reviewer)).rejects.toThrow("Only memory-manager")
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

  it("does not let the audit create backups", async () => {
    await expect(fixture().backup.execute({}, reviewer)).rejects.toThrow("Only memory-manager")
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
