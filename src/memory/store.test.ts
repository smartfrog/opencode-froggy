import { rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { openSqlite } from "./sqlite"
import { MemoryStore } from "./store"

const directories: string[] = []
const stores: MemoryStore[] = []

function store() {
  const directory = createTemporaryDirectory("froggy-memory-")
  directories.push(directory)
  const database = openSqlite(join(directory, "memory.db"))
  const memory = new MemoryStore(database)
  stores.push(memory)
  return { database, memory }
}

afterEach(() => {
  for (const instance of stores.splice(0)) instance.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("memory store", () => {
  it("updates task status and description together", () => {
    const { memory } = store()
    memory.saveTask("T", { title: "Task", status: "blocked", description: "Coordinator hold." })
    memory.saveTask("T", { status: "in-progress", description: "Hold released; worker dispatched, execution unconfirmed." }, 1)
    expect(memory.getTask("T")).toMatchObject({ version: 2, status: "in-progress", description: "Hold released; worker dispatched, execution unconfirmed." })
  })

  it("keeps unrelated task fields when saving a patch", () => {
    const { memory } = store()
    memory.saveTask("T", { title: "Task", description: "Scope and acceptance." })
    memory.saveTask("T", { status: "review" }, 1)
    expect(memory.getTask("T")).toMatchObject({ title: "Task", description: "Scope and acceptance.", status: "review" })
  })

  it("filters task status", () => {
    const { memory } = store()
    memory.saveTask("T", { title: "Task" })
    memory.saveTask("R", { title: "Review", status: "review" })
    expect(memory.listTasks("review").map(({ id }) => id)).toEqual(["R"])
  })

  it.each(["archived", "unknown"])("rejects unsupported task status %s", (status) => {
    const { memory } = store()
    expect(() => memory.saveTask("T", { title: "Task", status })).toThrow("Invalid task status")
    expect(memory.getTask("T")).toBeNull()
  })

  it("rejects a competing connection's task update", () => {
    const { memory: first, database } = store()
    first.saveTask("T", { title: "Task" })
    const directory = directories.at(-1)!
    const second = new MemoryStore(openSqlite(join(directory, "memory.db")))
    stores.push(second)
    second.saveTask("T", { description: "Second writer" }, 1)
    expect(() => first.saveTask("T", { description: "Stale writer" }, 1)).toThrow("expected version 1, current 2")
    expect(database.prepare("SELECT description FROM tasks WHERE id = 'T'").get()).toEqual({ description: "Second writer" })
  })

  it("reads task state after beginning its write transaction", () => {
    const { database } = store()
    const trace: string[] = []
    const memory = new MemoryStore({
      exec: (sql) => { trace.push(sql); database.exec(sql) },
      prepare: (sql) => { trace.push(sql); return database.prepare(sql) },
      serialize: () => database.serialize(),
      close: () => {},
    })
    memory.saveTask("T", { title: "Task" })
    trace.length = 0
    memory.saveTask("T", { status: "review" }, 1)
    expect(trace.indexOf("SELECT * FROM tasks WHERE id = ?")).toBeGreaterThan(trace.indexOf("BEGIN IMMEDIATE"))
  })

  it("does not create a history table", () => {
    const { memory, database } = store()
    memory.saveTask("T", { title: "Task" })
    memory.saveTask("T", { status: "done" }, 1)
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'history'").get()).toBeNull()
  })

  it("does not create a progress-note table", () => {
    const { database } = store()
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'task_notes'").get()).toBeNull()
  })

  it("searches knowledge by content and topic", () => {
    const { memory } = store()
    memory.saveNote("idle", { title: "Idle scheduling", topic: "performance", content: "Measure cycle accounting." })
    expect(memory.listNotes({ query: "accounting", topic: "performance" }).map(({ id }) => id)).toEqual(["idle"])
    expect(memory.listNotes({ query: "accounting", topic: "build" })).toEqual([])
  })

  it("requires a version to update existing knowledge", () => {
    const { memory } = store()
    memory.saveNote("idle", { title: "Idle scheduling", topic: "performance", content: "Measure." })
    expect(() => memory.saveNote("idle", { content: "Overwrite." })).toThrow("provide expectedVersion")
  })

  it("does not reuse a deleted knowledge version when its ID is recreated", () => {
    const { memory } = store()
    const first = memory.saveNote("rule", { title: "Rule", topic: "constraints", content: "Original." })
    memory.removeNote("rule", first.version)
    const replacement = memory.saveNote("rule", { title: "Rule", topic: "constraints", content: "Replacement." })
    expect(replacement.version).toBeGreaterThan(first.version)
    expect(() => memory.removeNote("rule", first.version)).toThrow("changed")
  })

  it("physically removes a knowledge row", () => {
    const { memory, database } = store()
    const saved = memory.saveNote("rule", { title: "Rule", topic: "constraints", content: "Refuted." })
    memory.removeNote("rule", saved.version)
    expect(database.prepare("SELECT * FROM knowledge").all()).toEqual([])
  })

  it("rolls back a rejected conditional task update", () => {
    const { memory, database } = store()
    memory.saveTask("T", { title: "Original" })
    database.exec("CREATE TRIGGER skip_update BEFORE UPDATE ON tasks BEGIN SELECT RAISE(IGNORE); END")
    expect(() => memory.saveTask("T", { title: "Lost" }, 1)).toThrow("changed")
    expect(memory.getTask("T")).toMatchObject({ title: "Original", version: 1 })
  })

  it("rolls back a rejected knowledge deletion", () => {
    const { memory, database } = store()
    const saved = memory.saveNote("rule", { title: "Rule", topic: "constraints", content: "Keep." })
    database.exec("CREATE TRIGGER skip_delete BEFORE DELETE ON knowledge BEGIN SELECT RAISE(IGNORE); END")
    expect(() => memory.removeNote("rule", saved.version)).toThrow("changed")
    expect(memory.getNote("rule")).toMatchObject({ content: "Keep." })
  })

  it.each(["", " "])("rejects blank knowledge content %j", (content) => {
    const { memory } = store()
    expect(() => memory.saveNote("rule", { title: "Rule", topic: "constraints", content })).toThrow("content is required")
  })
})
