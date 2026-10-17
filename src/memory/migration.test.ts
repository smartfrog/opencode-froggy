import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { openProjectMemory } from "./project"
import { openSqlite } from "./sqlite"
import { MemoryStore } from "./store"

const directories: string[] = []

function legacy() {
  const directory = createTemporaryDirectory("froggy-migration-")
  directories.push(directory)
  const memory = join(directory, ".opencode", "memory")
  mkdirSync(memory, { recursive: true })
  const path = join(memory, "memory.db")
  const database = openSqlite(path)
  database.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT, status TEXT, objective TEXT, acceptance TEXT,
      current_state TEXT, next_action TEXT, blockers TEXT, knowledge_refs TEXT,
      evidence TEXT, assignments TEXT, revision INTEGER, updated_at INTEGER,
      updated_by TEXT, updated_session TEXT
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY, topic TEXT, kind TEXT, title TEXT, content TEXT,
      sources TEXT, status TEXT, superseded_by TEXT, revision INTEGER,
      updated_at INTEGER, updated_by TEXT, updated_session TEXT
    );
    CREATE TABLE history (entity TEXT, entity_id TEXT, revision INTEGER, snapshot TEXT);
  `)
  database.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "GAMEPLAY", "Reach gameplay", "review", "Run the game", "Reach playable state", "Worker dispatched; run unconfirmed",
    "Inspect evidence", "Private input custody unresolved", '["memory-limit"]', '["reports/trial.md"]',
    '["general ses_worker /worktree abc123"]', 7, 1234, "memory-manager", "ses_old",
  )
  database.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "memory-limit", "constraints", "constraint", "Memory ceiling", "Keep usage below 6 GiB.", '["reports/memory.md"]',
    "active", null, 3, 1234, "memory-manager", "ses_old",
  )
  database.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "old-limit", "constraints", "fact", "Old ceiling", "Refuted ceiling.", "[]", "superseded", "memory-limit", 2, 1000, "memory-manager", "ses_old",
  )
  database.prepare("INSERT INTO history VALUES (?, ?, ?, ?)").run("note", "memory-limit", 1, '{"content":"Earlier evidence"}')
  return { directory, memory, path, database }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("simple memory migration", () => {
  it("keeps backups self-contained without WAL sidecars", () => {
    const fixture = legacy()
    fixture.database.close()
    const migrated = openProjectMemory(fixture.directory)
    const backup = migrated.store.migrationBackup!
    migrated.store.close()
    expect(existsSync(`${backup}-wal`)).toBe(false)
    expect(existsSync(`${backup}-shm`)).toBe(false)
    const copy = openSqlite(backup, true)
    expect(copy.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" })
    copy.close()
  })

  it("preserves oversized legacy labels in readable content", () => {
    const fixture = legacy()
    const title = "Original title ".repeat(300)
    const topic = "Original topic ".repeat(300)
    fixture.database.prepare("UPDATE tasks SET title = ?").run(title)
    fixture.database.prepare("UPDATE notes SET title = ?, topic = ?").run(title, topic)
    fixture.database.close()
    const migrated = openProjectMemory(fixture.directory)
    try {
      const task = migrated.store.getTask("GAMEPLAY")!
      const note = migrated.store.getNote("memory-limit")!
      expect(Array.from(task.title).length).toBeLessThanOrEqual(200)
      expect(task.description).toContain(title)
      expect(Array.from(note.topic).length).toBeLessThanOrEqual(80)
      expect(note.content).toContain(title)
      expect(note.content).toContain(topic)
    } finally {
      migrated.store.close()
    }
  })
  it("preserves task details and evidence in its description", () => {
    const fixture = legacy()
    fixture.database.close()
    const migrated = openProjectMemory(fixture.directory)
    try {
      const task = migrated.store.getTask("GAMEPLAY")!
      expect(task.status).toBe("review")
      for (const value of ["Run the game", "Reach playable state", "Worker dispatched; run unconfirmed", "Inspect evidence", "Private input custody unresolved", "memory-limit", "reports/trial.md", "general ses_worker /worktree abc123"]) {
        expect(task.description).toContain(value)
      }
    } finally {
      migrated.store.close()
    }
  })

  it("preserves active knowledge with its source links", () => {
    const fixture = legacy()
    fixture.database.close()
    const migrated = openProjectMemory(fixture.directory)
    try {
      expect(migrated.store.getNote("memory-limit")).toMatchObject({ title: "Memory ceiling", topic: "constraints" })
      expect(migrated.store.getNote("memory-limit")!.content).toContain("Keep usage below 6 GiB.")
      expect(migrated.store.getNote("memory-limit")!.content).toContain("reports/memory.md")
      expect(migrated.store.getNote("old-limit")).toBeNull()
    } finally {
      migrated.store.close()
    }
  })

  it("retains a verified standalone backup including superseded records and history", () => {
    const fixture = legacy()
    fixture.database.close()
    const migrated = openProjectMemory(fixture.directory)
    const path = migrated.store.migrationBackup!
    migrated.store.close()
    expect(existsSync(path)).toBe(true)
    const backup = openSqlite(path, true)
    try {
      expect(backup.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
      expect(backup.prepare("SELECT count(*) AS count FROM notes").get()).toEqual({ count: 2 })
      expect(backup.prepare("SELECT count(*) AS count FROM history").get()).toEqual({ count: 1 })
    } finally {
      backup.close()
    }
  })

  it("does not repeat the migration or create another backup when reopened", () => {
    const fixture = legacy()
    fixture.database.close()
    openProjectMemory(fixture.directory).store.close()
    const reopened = openProjectMemory(fixture.directory)
    expect(reopened.store.migrationBackup).toBeNull()
    reopened.store.close()
    expect(readdirSync(fixture.memory).filter((name) => name.endsWith(".bak"))).toHaveLength(1)
  })

  it("rolls back conversion when legacy references are invalid", () => {
    const fixture = legacy()
    fixture.database.exec("UPDATE tasks SET evidence = 'not JSON'")
    fixture.database.close()
    expect(() => openProjectMemory(fixture.directory)).toThrow()
    const original = openSqlite(fixture.path)
    try {
      expect(original.prepare("SELECT revision, evidence FROM tasks").get()).toEqual({ revision: 7, evidence: "not JSON" })
      expect(original.prepare("SELECT count(*) AS count FROM history").get()).toEqual({ count: 1 })
    } finally {
      original.close()
    }
  })

  it("keeps the source schema when backup creation fails", () => {
    const fixture = legacy()
    expect(() => new MemoryStore(fixture.database, join(fixture.directory, "missing", "memory.db"))).toThrow()
    expect(fixture.database.prepare("SELECT revision FROM tasks").get()).toEqual({ revision: 7 })
    fixture.database.close()
  })

  it("maps an archived task to done without losing its former state", () => {
    const fixture = legacy()
    fixture.database.exec("UPDATE tasks SET status = 'archived'")
    fixture.database.close()
    const migrated = openProjectMemory(fixture.directory)
    try {
      expect(migrated.store.getTask("GAMEPLAY")).toMatchObject({ status: "done" })
      expect(migrated.store.getTask("GAMEPLAY")!.description).toContain("Previously archived")
    } finally {
      migrated.store.close()
    }
  })
})
