import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { openProjectMemory } from "../memory/project"
import { MemoryStore } from "../memory/store"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createTaskBoardTool } from "./task-board"

const directories: string[] = []
const context = { agent: "memory-manager", sessionID: "ses_test" }

function tool() {
  const directory = createTemporaryDirectory("froggy-tasks-")
  directories.push(directory)
  return createTaskBoardTool(directory)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("task-board read safety", () => {
  it.each([{ action: "list" }, { action: "get", id: "T" }])("does not create a database for %j", async (input) => {
    const memory = tool()
    await expect(memory.execute(input, context)).rejects.toThrow("No project memory database exists")
    expect(existsSync(join(directories[0], ".opencode"))).toBe(false)
  })
})

describe("task-board markdown reads", () => {
  it("renders every status column and hides done by default", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T1", title: "Open task", status: "review" }, context)
    await memory.execute({ action: "save", id: "T2", title: "Done task", status: "done" }, context)
    const content = (await memory.execute({ action: "list" }, context)).content
    expect(content).toContain("| todo (0) | in-progress (0) | review (1) | blocked (0) |")
    expect(content).toContain("T1 — Open task")
    expect(content).not.toContain("T2")
  })

  it("renders one status column on request", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T2", title: "Done task", status: "done" }, context)
    expect((await memory.execute({ action: "list", status: "done" }, context)).content).toContain("| done (1) |")
  })

  it("renders a task with its version, description and notes", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task", description: "Details." }, context)
    await memory.execute({ action: "note", id: "T", note: "Progress." }, context)
    const content = (await memory.execute({ action: "get", id: "T" }, context)).content
    expect(content).toContain("**T** — Task")
    expect(content).toContain("Version: 2")
    expect(content).toContain("Details.")
    expect(content).toContain("Progress.")
  })

  it("reads every note, the full description and escaped titles", async () => {
    const memory = tool()
    const description = "x".repeat(8_000)
    await memory.execute({ action: "save", id: "T", title: "A | B", description }, context)
    for (let index = 0; index < 12; index++) await memory.execute({ action: "note", id: "T", note: `note ${index}` }, context)
    const content = (await memory.execute({ action: "get", id: "T" }, context)).content
    expect(content).toContain("A \\| B")
    expect(content).toContain(description)
    for (let index = 0; index < 12; index++) expect(content).toContain(`note ${index}`)
  })

  it("lists more than ten tasks at once", async () => {
    const memory = tool()
    for (let index = 0; index < 12; index++) await memory.execute({ action: "save", id: `T${index}`, title: `Task ${index}` }, context)
    const content = (await memory.execute({ action: "list" }, context)).content
    for (let index = 0; index < 12; index++) expect(content).toContain(`T${index} — Task ${index}`)
  })

  it("reads a task whose notes alone exceed 60000 characters", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    for (let index = 0; index < 121; index++) await memory.execute({ action: "note", id: "T", note: `${index}:` + "y".repeat(490) }, context)
    const content = (await memory.execute({ action: "get", id: "T" }, context)).content
    expect(content.length).toBeGreaterThan(60_000)
    expect(content).toContain("Version: 122")
    for (let index = 0; index < 121; index++) expect(content).toContain(`${index}:` + "y".repeat(490))
  })

  it("rejects expectedVersion on reads", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    await expect(memory.execute({ action: "get", id: "T", expectedVersion: 1 }, context)).rejects.toThrow("only valid for writes")
  })

  it("preserves a large task description through a status update", async () => {
    const memory = tool()
    const description = "x".repeat(70_000)
    await memory.execute({ action: "save", id: "T", title: "Task", description }, context)
    await memory.execute({ action: "save", id: "T", expectedVersion: 1, status: "review" }, context)
    const content = (await memory.execute({ action: "get", id: "T" }, context)).content
    expect(content).toContain(description)
    expect(content).toContain("Status: review")
  })

  it("returns a board exceeding 60000 characters without dropping tasks", async () => {
    const memory = tool()
    for (let index = 0; index < 310; index++) await memory.execute({ action: "save", id: `T${index}`, title: "x".repeat(200) }, context)
    const content = (await memory.execute({ action: "list", status: "todo" }, context)).content
    expect(content.length).toBeGreaterThan(60_000)
    for (let index = 0; index < 310; index++) expect(content).toContain(`T${index} — `)
  })

  it("reads the task version and notes from the same snapshot", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    const writer = openProjectMemory(directories[0])
    const original = MemoryStore.prototype.getTask
    const read = spyOn(MemoryStore.prototype, "getTask").mockImplementation(function (this: MemoryStore, id: string) {
      const task = original.call(this, id)
      read.mockRestore()
      writer.store.addTaskNote(id, "Concurrent note")
      return task
    })
    try {
      const content = (await memory.execute({ action: "get", id: "T" }, context)).content
      expect(content).toContain("Version: 1")
      expect(content).not.toContain("Concurrent note")
      expect(writer.store.getTask("T")?.version).toBe(2)
    } finally {
      read.mockRestore()
      writer.store.close()
    }
  })

  it("rejects a stale note without changing the stored task", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    await memory.execute({ action: "save", id: "T", expectedVersion: 1, status: "review" }, context)
    await expect(memory.execute({ action: "note", id: "T", expectedVersion: 1, note: "Stale progress." }, context)).rejects.toThrow("changed")
    const content = (await memory.execute({ action: "get", id: "T" }, context)).content
    expect(content).toContain("Version: 2")
    expect(content).not.toContain("Stale progress.")
  })

  it.each(["orchestrator", "build", "general", "code-reviewer"])("allows reads by %s", async (agent) => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    expect((await memory.execute({ action: "get", id: "T" }, { agent })).content).toContain("**T** — Task")
  })

  it("requires a current session for memory-manager writes", async () => {
    await expect(tool().execute({ action: "save", id: "T", title: "Task" }, { agent: "memory-manager" })).rejects.toThrow("A current session is required")
  })

  it.each(["objective", "expectedRevision", "field", "item", "offset", "page", "format"])("rejects removed parameter %s rather than ignoring it", async (field) => {
    await expect(tool().execute({ action: "save", id: "T", title: "Task", [field]: "old" }, context)).rejects.toThrow("Unsupported memory parameter")
  })
})
