import { existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { openProjectMemory } from "../memory/project"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createKnowledgeTool } from "./knowledge"
import { createMemoryOverviewTool } from "./memory-overview"
import { createTaskBoardTool } from "./task-board"

const directories: string[] = []
const writer = { agent: "memory-manager", sessionID: "ses_test" }

function setup() {
  const directory = createTemporaryDirectory("froggy-overview-")
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("memory overview", () => {
  it("does not create a database for an empty project", async () => {
    const directory = setup()
    await expect(createMemoryOverviewTool(directory).execute({})).rejects.toThrow("No project memory database exists")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })

  it("renders task counts and knowledge topics", async () => {
    const directory = setup()
    const tasks = createTaskBoardTool(directory)
    const knowledge = createKnowledgeTool(directory)
    await tasks.execute({ action: "save", id: "T1", title: "One", status: "review" }, writer)
    await tasks.execute({ action: "save", id: "T2", title: "Two", status: "done" }, writer)
    await tasks.execute({ action: "save", id: "T3", title: "Three" }, writer)
    await tasks.execute({ action: "save", id: "T4", title: "Four", status: "review" }, writer)
    await knowledge.execute({ action: "save", id: "K1", title: "Note", topic: "build", content: "Folders" }, writer)

    const content = (await createMemoryOverviewTool(directory).execute({})).content
    expect(content).toContain("Store: `")
    expect(content).toContain("| todo | 1 |")
    expect(content).toContain("| review | 2 |")
    expect(content).toContain("| done | 1 |")
    expect(content).toContain("| build | 1 |")
  })

  it("does not change an existing store", async () => {
    const directory = setup()
    await createTaskBoardTool(directory).execute({ action: "save", id: "T1", title: "One" }, writer)
    const memoryDirectory = join(directory, ".opencode", "memory")
    const files = () => readdirSync(memoryDirectory).sort()
    const task = () => {
      const memory = openProjectMemory(directory, { readonly: true })
      try {
        return memory.store.getTask("T1")
      } finally {
        memory.store.close()
      }
    }
    const before = { files: files(), task: task() }
    await createMemoryOverviewTool(directory).execute({})
    expect({ files: files(), task: task() }).toEqual(before)
  })

  it("includes every knowledge topic", async () => {
    const directory = setup()
    const knowledge = createKnowledgeTool(directory)
    for (let index = 0; index < 21; index++) {
      await knowledge.execute({ action: "save", id: `K${index}`, title: `Note ${index}`, topic: `topic-${String(index).padStart(2, "0")}`, content: "x" }, writer)
    }
    const content = (await createMemoryOverviewTool(directory).execute({})).content
    expect(content.match(/\| topic-\d\d \| 1 \|/g)).toHaveLength(21)
  })
})
