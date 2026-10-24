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

describe("task-board without progress notes", () => {
  it("exposes only task reads and saves", () => {
    expect(tool().input.properties.action.enum).toEqual(["list", "get", "save"])
  })

  it.each(["note", "noteId", "noteIds"])("does not expose the retired %s field", (field) => {
    expect(tool().input.properties).not.toHaveProperty(field)
  })

  it.each(["note", "edit-note", "remove-notes"])("rejects retired action %s before opening memory", async (action) => {
    const memory = tool()
    await expect(memory.execute({ action, id: "T" }, context)).rejects.toThrow("action must be list, get, save")
    expect(existsSync(join(directories.at(-1)!, ".opencode"))).toBe(false)
  })
})

describe("task-board validation", () => {
  it.each([{ action: "list" }, { action: "get", id: "T" }])("does not create a database for %j", async (input) => {
    const memory = tool()
    await expect(memory.execute(input, context)).rejects.toThrow("No project memory database exists")
    expect(existsSync(join(directories.at(-1)!, ".opencode"))).toBe(false)
  })

  it.each([["get"], null, {}, 7].map((action) => ({ action })))("rejects a non-string action %j before opening memory", async ({ action }) => {
    const memory = tool()
    await expect(memory.execute({ action, id: "T", title: "Unintended task" }, context)).rejects.toThrow("action must")
    expect(existsSync(join(directories.at(-1)!, ".opencode"))).toBe(false)
  })

  it.each(["objective", "expectedRevision", "field", "item", "offset", "page", "format", "note", "noteId", "noteIds"])("rejects removed parameter %s rather than ignoring it", async (field) => {
    const memory = tool()
    await expect(memory.execute({ action: "save", id: "T", title: "Task", [field]: "old" }, context)).rejects.toThrow("Unsupported memory parameter")
    expect(existsSync(join(directories.at(-1)!, ".opencode"))).toBe(false)
  })

  it("rejects expectedVersion on reads", async () => {
    await expect(tool().execute({ action: "get", id: "T", expectedVersion: 1 }, context)).rejects.toThrow("only valid for writes")
  })

  it("requires a current session for memory-manager writes", async () => {
    await expect(tool().execute({ action: "save", id: "T", title: "Task" }, { agent: "memory-manager" })).rejects.toThrow("A current session is required")
  })

  it("reports a missing task", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    await expect(memory.execute({ action: "get", id: "missing" }, context)).rejects.toThrow("Task not found: missing")
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
    await memory.execute({ action: "save", id: "T", title: "Done task", status: "done" }, context)
    expect((await memory.execute({ action: "list", status: "done" }, context)).content).toContain("| done (1) |")
  })

  it("renders task metadata and its current description without a notes section", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task", description: "Details." }, context)
    expect((await memory.execute({ action: "get", id: "T" }, context)).content).toBe(
      "**T** — Task\n\nStatus: todo\nVersion: 1\n\nDetails.",
    )
  })

  it("reads the full description and escapes the title", async () => {
    const memory = tool()
    const description = "x".repeat(8_000)
    await memory.execute({ action: "save", id: "T", title: "A | B", description }, context)
    const content = (await memory.execute({ action: "get", id: "T" }, context)).content
    expect(content).toContain("A \\| B")
    expect(content).toContain(description)
  })

  it("lists more than ten tasks at once", async () => {
    const memory = tool()
    for (let index = 0; index < 12; index++) await memory.execute({ action: "save", id: `T${index}`, title: `Task ${index}` }, context)
    const content = (await memory.execute({ action: "list" }, context)).content
    for (let index = 0; index < 12; index++) expect(content).toContain(`T${index} — Task ${index}`)
  })

  it("returns a board exceeding 60000 characters without dropping tasks", async () => {
    const memory = tool()
    for (let index = 0; index < 310; index++) await memory.execute({ action: "save", id: `T${index}`, title: "x".repeat(200) }, context)
    const content = (await memory.execute({ action: "list", status: "todo" }, context)).content
    expect(content.length).toBeGreaterThan(60_000)
    for (let index = 0; index < 310; index++) expect(content).toContain(`T${index} — `)
  })

  it("reads the task version and description from the same row", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task", description: "Original state." }, context)
    const writer = openProjectMemory(directories.at(-1)!)
    const original = MemoryStore.prototype.getTask
    const read = spyOn(MemoryStore.prototype, "getTask").mockImplementation(function (this: MemoryStore, id: string) {
      const task = original.call(this, id)
      read.mockRestore()
      writer.store.saveTask(id, { description: "Concurrent state." }, 1)
      return task
    })
    try {
      const content = (await memory.execute({ action: "get", id: "T" }, context)).content
      expect(content).toContain("Version: 1")
      expect(content).toContain("Original state.")
      expect(content).not.toContain("Concurrent state.")
      expect(writer.store.getTask("T")?.version).toBe(2)
    } finally {
      read.mockRestore()
      writer.store.close()
    }
  })

  it.each(["orchestrator", "build", "general", "code-reviewer"])("allows reads by %s", async (agent) => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    expect((await memory.execute({ action: "get", id: "T" }, { agent })).content).toContain("**T** — Task")
  })
})

describe("task-board current synthesis", () => {
  it("replaces the previous description rather than appending a history", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task", description: "Obsolete blocker." }, context)
    await memory.execute({ action: "save", id: "T", expectedVersion: 1, description: "Ready for review.", status: "review" }, context)
    const content = (await memory.execute({ action: "get", id: "T" }, context)).content
    expect(content).toContain("Ready for review.")
    expect(content).not.toContain("Obsolete blocker.")
    expect(content).toContain("Status: review")
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

  it("rejects an update without the task version", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    await expect(memory.execute({ action: "save", id: "T", description: "Overwrite." }, context)).rejects.toThrow("provide expectedVersion")
  })
})
