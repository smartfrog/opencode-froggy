import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "bun:test"
import { loadCommands } from "../loaders"
import { openProjectMemory } from "../memory/project"
import { openSqlite } from "../memory/sqlite"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import * as tools from "./index"

const directories: string[] = []

function project() {
  const directory = createTemporaryDirectory("froggy-memory-review-")
  directories.push(directory)
  return directory
}

function fixture() {
  const directory = project()
  const memory = openProjectMemory(directory)
  memory.store.close()
  return { directory, tool: tools.createMemoryReviewTool(directory) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("global knowledge review inventory", () => {
  it("lists topics and entry counts without loading knowledge content", async () => {
    const { directory, tool } = fixture()
    const memory = openProjectMemory(directory)
    try {
      memory.store.saveNote("limit", { title: "Memory ceiling", topic: "constraints", content: "6 GiB limit." })
      memory.store.saveNote("idle", { title: "Idle loop", topic: "performance", content: "Measure cycle accounting." })
      memory.store.saveNote("renderer", { title: "Renderer tip", topic: "performance", content: "Check the benchmark." })
    } finally {
      memory.store.close()
    }
    const response = JSON.parse((await tool.execute({})).content)
    expect(response).toMatchObject({
      knowledgeCount: 3, topicCount: 2,
      topics: [{ topic: "constraints", count: 1 }, { topic: "performance", count: 2 }], nextPage: null,
    })
    expect(response).not.toHaveProperty("content")
  })

  it("returns an empty inventory for an initialized empty project", async () => {
    const { tool } = fixture()
    expect(JSON.parse((await tool.execute({})).content)).toMatchObject({ knowledgeCount: 0, topicCount: 0, topics: [], nextPage: null })
  })

  it("visits every topic through bounded pages", async () => {
    const { directory, tool } = fixture()
    const memory = openProjectMemory(directory)
    try {
      for (let index = 0; index < 45; index++) {
        memory.store.saveNote(`K${index}`, { title: `Entry ${index}`, topic: "\u0000".repeat(75) + String(index), content: "Keep." })
      }
    } finally {
      memory.store.close()
    }
    let page: number | null = 0
    const topics: string[] = []
    while (page !== null) {
      const result = await tool.execute({ page })
      expect(result.content.length).toBeLessThanOrEqual(20_000)
      const response = JSON.parse(result.content) as { topics: { topic: string }[]; nextPage: number | null }
      topics.push(...response.topics.map(({ topic }) => topic))
      page = response.nextPage
    }
    expect(new Set(topics).size).toBe(45)
  })

  it("leaves tasks, knowledge and their versions unchanged", async () => {
    const { directory, tool } = fixture()
    const memory = openProjectMemory(directory)
    memory.store.saveTask("T", { title: "Task", status: "review", description: "Task acceptance belongs to the coordinator." })
    memory.store.saveNote("rule", { title: "Rule", topic: "constraints", content: "Do not delete without validation." })
    memory.store.close()
    const path = join(directory, ".opencode", "memory", "memory.db")
    const database = openSqlite(path, true)
    try {
      const before = Buffer.from(database.serialize())
      await tool.execute({})
      expect(Buffer.from(database.serialize()).equals(before)).toBe(true)
    } finally {
      database.close()
    }
  })

  it("does not create a missing project database", async () => {
    const directory = project()
    await expect(tools.createMemoryReviewTool(directory).execute({})).rejects.toThrow("No project memory database")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })

  it("does not migrate an older database during a review", async () => {
    const directory = project()
    const memoryDirectory = join(directory, ".opencode", "memory")
    mkdirSync(memoryDirectory, { recursive: true })
    const database = openSqlite(join(memoryDirectory, "memory.db"))
    database.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, objective TEXT); INSERT INTO tasks VALUES ('T', 'Original scope')")
    database.close()
    await expect(tools.createMemoryReviewTool(directory).execute({})).rejects.toThrow("current memory schema")
    expect(readdirSync(memoryDirectory).some((name) => name.endsWith(".bak"))).toBe(false)
  })

  it("rejects a memory directory symlinked outside the project", async () => {
    const target = fixture()
    const source = project()
    mkdirSync(join(source, ".opencode"))
    symlinkSync(join(target.directory, ".opencode", "memory"), join(source, ".opencode", "memory"))
    await expect(tools.createMemoryReviewTool(source).execute({})).rejects.toThrow("Symbolic links")
  })

  it.each([-1, 0.5, "0", null])("rejects invalid page %j", async (page) => {
    await expect(fixture().tool.execute({ page })).rejects.toThrow("page")
  })

  it("does not accept a mutation action", async () => {
    await expect(fixture().tool.execute({ action: "remove", id: "rule" })).rejects.toThrow("Unsupported memory parameter")
  })
})

describe("memory review command", () => {
  it("runs the report through the memory manager in a child session", () => {
    const commands = loadCommands(fileURLToPath(new URL("../../command/", import.meta.url)))
    expect(commands["memory-review"]).toMatchObject({ agent: "memory-manager", subagent: true })
  })
})
