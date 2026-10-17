import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { openSqlite } from "./sqlite"
import { MemoryStore } from "./store"

const directories: string[] = []
const stores: MemoryStore[] = []

function store(): MemoryStore {
  const directory = mkdtempSync(join(tmpdir(), "froggy-memory-"))
  directories.push(directory)
  const database = openSqlite(join(directory, "memory.db"))
  const instance = new MemoryStore(database)
  stores.push(instance)
  return instance
}

function twoStores() {
  const directory = mkdtempSync(join(tmpdir(), "froggy-memory-"))
  directories.push(directory)
  const path = join(directory, "memory.db")
  const database = openSqlite(path)
  let beforeBegin: (() => void) | undefined
  const first = new MemoryStore({
    exec(sql) {
      if (sql === "BEGIN IMMEDIATE" && beforeBegin) {
        const commit = beforeBegin
        beforeBegin = undefined
        commit()
      }
      database.exec(sql)
    },
    prepare: (sql) => database.prepare(sql),
    close: () => database.close(),
  })
  const second = new MemoryStore(openSqlite(path))
  stores.push(first, second)
  return { first, second, beforeNextWrite: (commit: () => void) => { beforeBegin = commit } }
}

afterEach(() => {
  for (const instance of stores.splice(0)) instance.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("memory store tasks", () => {
  it("creates, lists and updates a task with revision history", () => {
    const memory = store()
    expect(memory.saveTask("GAMEPLAY", {
      title: "Reach gameplay",
      objective: "Run the game",
      nextAction: "Run trial #14",
      assignments: ["general ses_worker /tmp/worktree abc123"],
    }, "build", "ses_test")).toEqual({ id: "GAMEPLAY", revision: 1, created: true })

    expect(memory.listTasks()).toMatchObject([{ id: "GAMEPLAY", status: "todo", nextAction: "Run trial #14" }])

    expect(memory.saveTask("GAMEPLAY", { status: "in-progress", nextAction: "Watch the run" }, "build", "ses_test", 1))
      .toEqual({ id: "GAMEPLAY", revision: 2, created: false })

    expect(memory.getTask("GAMEPLAY")).toMatchObject({
      status: "in-progress",
      nextAction: "Watch the run",
      assignments: ["general ses_worker /tmp/worktree abc123"],
      revision: 2,
    })
    expect(memory.history("task", "GAMEPLAY")).toMatchObject([{ revision: 1 }])
  })

  it("rejects a stale task revision", () => {
    const memory = store()
    memory.saveTask("T", { title: "Task" }, "build", "ses_test")
    memory.saveTask("T", { nextAction: "Second" }, "build", "ses_test", 1)

    expect(() => memory.saveTask("T", { nextAction: "Stale" }, "build", "ses_test", 1))
      .toThrow("expected revision 1, current 2")
  })

  it("reads the current revision inside the update transaction", () => {
    const directory = mkdtempSync(join(tmpdir(), "froggy-memory-"))
    directories.push(directory)
    const database = openSqlite(join(directory, "memory.db"))
    const trace: string[] = []
    const wrapped = {
      exec(sql: string) {
        trace.push(`exec:${sql}`)
        database.exec(sql)
      },
      prepare(sql: string) {
        trace.push(`prepare:${sql}`)
        return database.prepare(sql)
      },
      close() {
        database.close()
      },
    }
    const memory = new MemoryStore(wrapped)
    stores.push(memory)
    memory.saveTask("T", { title: "Task" }, "build", "ses_test")
    trace.length = 0
    memory.saveTask("T", { nextAction: "Next" }, "build", "ses_test", 1)

    const begin = trace.findIndex((entry) => entry.includes("BEGIN IMMEDIATE"))
    const read = trace.findIndex((entry) => entry.includes("SELECT * FROM tasks WHERE id = ?"))
    expect(begin).not.toBe(-1)
    expect(read).toBeGreaterThan(begin)
  })

  it("rejects a competing connection's commit immediately before the task update transaction", () => {
    const { first, second, beforeNextWrite } = twoStores()
    first.saveTask("T", { title: "Task", nextAction: "Original" }, "build", "ses_test")
    beforeNextWrite(() => second.saveTask("T", { nextAction: "Second" }, "build", "ses_test", 1))
    expect(() => first.saveTask("T", { nextAction: "Stale" }, "build", "ses_test", 1))
      .toThrow("expected revision 1, current 2")

    expect(first.getTask("T")).toMatchObject({ nextAction: "Second", revision: 2 })
    expect(first.history("task", "T")).toHaveLength(1)
  })
})

describe("memory store knowledge", () => {
  it("rejects invalid replacement ids on creation", () => {
    const memory = store()
    expect(() => memory.saveNote("note", {
      topic: "runtime", title: "Note", content: "Content", supersededBy: "../outside",
    }, "memory-manager", "ses_test")).toThrow("Invalid supersededBy")
    expect(memory.getNote("note")).toBeNull()
  })
  it("creates and searches notes by topic", () => {
    const memory = store()
    memory.saveNote("runtime-cycles", {
      topic: "runtime",
      kind: "lesson",
      title: "Cycles during idle",
      content: "Check idle cycle accounting before blaming the renderer.",
      sources: ["report.md"],
    }, "memory-manager", "ses_test")

    expect(memory.searchNotes("renderer", { topic: "runtime" })).toMatchObject([
      { id: "runtime-cycles", topic: "runtime", kind: "lesson" },
    ])
    expect(memory.searchNotes("renderer", { topic: "build" })).toEqual([])
  })

  it("reports topics and project rules in the overview", () => {
    const memory = store()
    memory.saveNote("project-rules", {
      topic: "rules",
      kind: "constraint",
      title: "Project rules",
      content: "Never publish private packages.",
    }, "memory-manager", "ses_test")
    memory.saveNote("build-link", {
      topic: "build",
      kind: "fact",
      title: "Linker workaround",
      content: "Keep the weak symbol.",
    }, "memory-manager", "ses_test")

    expect(memory.overview()).toMatchObject({
      total: 2,
      projectRules: { id: "project-rules", content: "Never publish private packages." },
      topics: [{ topic: "build", count: 1 }, { topic: "rules", count: 1 }],
    })
  })

  it("rejects a competing connection's commit immediately before the note update transaction", () => {
    const { first, second, beforeNextWrite } = twoStores()
    first.saveNote("note", {
      topic: "runtime",
      kind: "fact",
      title: "Note",
      content: "Original",
    }, "memory-manager", "ses_test")

    beforeNextWrite(() => second.saveNote("note", { content: "Second" }, "memory-manager", "ses_test", 1))
    expect(() => first.saveNote("note", { content: "Stale" }, "memory-manager", "ses_test", 1))
      .toThrow("expected revision 1, current 2")

    expect(first.getNote("note")).toMatchObject({ content: "Second", revision: 2 })
    expect(first.history("note", "note")).toHaveLength(1)
  })

  it("keeps a superseded note out of active search and retains its previous revision", () => {
    const memory = store()
    memory.saveNote("decision", {
      topic: "runtime",
      kind: "decision",
      title: "Use option A",
      content: "Option A is selected.",
    }, "memory-manager", "ses_test")
    memory.saveNote("decision", {
      status: "superseded",
      supersededBy: "decision-b",
      content: "Option A is no longer selected.",
    }, "memory-manager", "ses_test", 1)

    expect(memory.searchNotes("selected")).toEqual([])
    expect(memory.getNote("decision")).toMatchObject({ status: "superseded", supersededBy: "decision-b" })
    expect(memory.history("note", "decision")).toMatchObject([{ revision: 1 }])
  })
})

describe("conditional memory updates", () => {
  it.each(["task", "note"] as const)("rejects a zero-row %s update without committing history", (entity) => {
    const directory = mkdtempSync(join(tmpdir(), "froggy-memory-"))
    directories.push(directory)
    const database = openSqlite(join(directory, "memory.db"))
    const memory = new MemoryStore(database)
    stores.push(memory)
    if (entity === "task") memory.saveTask("record", { title: "Original" }, "build", "ses_test")
    else memory.saveNote("record", { topic: "runtime", title: "Original", content: "Content" }, "memory-manager", "ses_test")
    database.exec(`CREATE TRIGGER skip_update BEFORE UPDATE ON ${entity === "task" ? "tasks" : "notes"} BEGIN SELECT RAISE(IGNORE); END`)

    const update = () => entity === "task"
      ? memory.saveTask("record", { title: "Lost" }, "build", "ses_test", 1)
      : memory.saveNote("record", { title: "Lost" }, "memory-manager", "ses_test", 1)
    expect(update).toThrow("changed: expected revision 1")
    const record = entity === "task" ? memory.getTask("record") : memory.getNote("record")
    expect(record).toMatchObject({ title: "Original", revision: 1 })
    expect(memory.history(entity, "record")).toEqual([])
  })
})
