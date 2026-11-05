import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { asRecord } from "../record"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { openProjectMemory } from "./project"
import { openSqlite } from "./sqlite"

const directories: string[] = []

function project() {
  const directory = createTemporaryDirectory("froggy-reliability-")
  directories.push(directory)
  return directory
}

function withStore(test: (store: ReturnType<typeof openProjectMemory>["store"]) => void) {
  const memory = openProjectMemory(project())
  try {
    test(memory.store)
  } finally {
    memory.store.close()
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("ranked knowledge search", () => {
  it("matches terms separated in the content", () => withStore((store) => {
    store.saveNote("heap", { title: "Build", topic: "runtime", content: "The heap has a ceiling of 6 GiB." })
    expect(store.listNotes({ query: "heap GiB" }).map((note) => note.id)).toEqual(["heap"])
  }))

  it("ranks a title match above a content-only match", () => withStore((store) => {
    store.saveNote("a", { title: "Background", topic: "build", content: "Authentication needs verification." })
    store.saveNote("z", { title: "Authentication", topic: "build", content: "Verify the caller." })
    expect(store.listNotes({ query: "authentication" })[0].id).toBe("z")
  }))

  it("matches accented text without requiring accents", () => withStore((store) => {
    store.saveNote("memoire", { title: "Mémoire", topic: "runtime", content: "Conserver les contraintes." })
    expect(store.listNotes({ query: "memoire" }).map((note) => note.id)).toEqual(["memoire"])
  }))

  it("searches technical paths as literal text", () => withStore((store) => {
    store.saveNote("path", { title: "Location", topic: "build", content: "Check src/memory/store.ts first." })
    expect(store.listNotes({ query: "src/memory/store.ts" }).map((note) => note.id)).toEqual(["path"])
  }))

  it("updates the index when knowledge changes", () => withStore((store) => {
    const saved = store.saveNote("rule", { title: "Rule", topic: "build", content: "Obsolete workaround." })
    store.saveNote("rule", { content: "Current solution." }, saved.version)
    expect(store.listNotes({ query: "obsolete" })).toEqual([])
  }))

  it.each(["\"", "*", "-", "NOT", "foo OR bar", "a:b"])('treats query %j as data', (query) => withStore((store) => {
    expect(() => store.listNotes({ query })).not.toThrow()
  }))
})

describe("restorable record history", () => {
  it("keeps only the last saved knowledge when it is removed", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    store.saveNote("other", { title: "Other", topic: "build", content: "Unrelated." })
    const next = store.saveNote("rule", { content: "Second." }, first.version)
    const removed = store.removeNote("rule", next.version)
    expect(store.listRevisions("knowledge", "rule").map(({ version, operation }) => ({ version, operation }))).toEqual([
      { version: removed.version, operation: "remove" },
      { version: next.version, operation: "save" },
    ])
    expect(() => store.getNoteRevision("rule", first.version)).toThrow("version not found")
  }))

  it("lists only the requested task's revisions newest first", () => withStore((store) => {
    const first = store.saveTask("T", { title: "Task" })
    store.saveTask("other", { title: "Other" })
    const next = store.saveTask("T", { description: "Updated." }, first.version)
    const restored = store.restoreTask("T", first.version, next.version)
    expect(store.listRevisions("task", "T").map(({ version }) => version)).toEqual([
      restored.version, next.version,
    ])
  }))

  it("keeps only current and previous knowledge across repeated saves", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    const second = store.saveNote("rule", { content: "Second." }, first.version)
    const third = store.saveNote("rule", { content: "Third." }, second.version)
    expect(store.listRevisions("knowledge", "rule").map(({ version }) => version)).toEqual([third.version, second.version])
    expect(store.getNoteRevision("rule", second.version).content).toBe("Second.")
    expect(() => store.getNoteRevision("rule", first.version)).toThrow("version not found")
  }))

  it("replaces the previous task version on each save", () => withStore((store) => {
    const first = store.saveTask("T", { title: "Task", description: "First." })
    const second = store.saveTask("T", { description: "Second." }, first.version)
    store.saveTask("T", { description: "Third." }, second.version)
    expect(store.getTaskRevision("T", second.version).description).toBe("Second.")
    expect(() => store.getTaskRevision("T", first.version)).toThrow("version not found")
  }))

  it("keeps the replaced knowledge as the previous version after restoration", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    const second = store.saveNote("rule", { content: "Second." }, first.version)
    const restored = store.restoreNote("rule", first.version, second.version)
    expect(store.listRevisions("knowledge", "rule").map(({ version }) => version)).toEqual([restored.version, second.version])
    expect(store.getNoteRevision("rule", second.version).content).toBe("Second.")
    expect(() => store.getNoteRevision("rule", first.version)).toThrow("version not found")
  }))

  it("drops deletion metadata after restoring the last removed knowledge", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    const removed = store.removeNote("rule", first.version)
    const restored = store.restoreNote("rule", first.version, removed.version)
    expect(store.listRevisions("knowledge", "rule").map(({ version, operation }) => ({ version, operation }))).toEqual([
      { version: restored.version, operation: "save" },
      { version: first.version, operation: "save" },
    ])
  }))

  it("keeps only the last removed knowledge when its ID is recreated", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    const second = store.saveNote("rule", { content: "Second." }, first.version)
    store.removeNote("rule", second.version)
    const recreated = store.saveNote("rule", { title: "New", topic: "build", content: "Third." })
    expect(store.listRevisions("knowledge", "rule").map(({ version }) => version)).toEqual([recreated.version, second.version])
    expect(() => store.getNoteRevision("rule", first.version)).toThrow("version not found")
  }))

  it("does not discard the previous version when a save conflicts", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    const second = store.saveNote("rule", { content: "Second." }, first.version)
    expect(() => store.saveNote("rule", { content: "Stale." }, first.version)).toThrow("changed")
    expect(store.listRevisions("knowledge", "rule").map(({ version }) => version)).toEqual([second.version, first.version])
  }))

  it("restores knowledge as a new current version", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Original", topic: "constraints", content: "Keep 6 GiB." })
    const second = store.saveNote("rule", { title: "Wrong", content: "Keep 12 GiB." }, first.version)
    const restored = store.restoreNote("rule", first.version, second.version)
    expect(store.getNote("rule")).toMatchObject({ title: "Original", content: "Keep 6 GiB.", version: restored.version })
    expect(restored.version).toBeGreaterThan(second.version)
  }))

  it("restores removed knowledge with its deletion version", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "constraints", content: "Unique recovery information." })
    const removed = store.removeNote("rule", first.version)
    store.restoreNote("rule", first.version, removed.version)
    expect(store.getNote("rule")?.content).toBe("Unique recovery information.")
  }))

  it("rejects restoration over a competing update", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    store.saveNote("rule", { content: "Second." }, first.version)
    expect(() => store.restoreNote("rule", first.version, first.version)).toThrow("changed")
  }))

  it("rejects a pending restore when another writer removes the current version", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    const next = store.saveNote("rule", { content: "Second." }, first.version)
    store.removeNote("rule", next.version)
    expect(() => store.restoreNote("rule", first.version, next.version)).toThrow("changed")
    expect(store.getNote("rule")).toBeNull()
  }))

  it("rejects an old deletion token after recreation and another deletion", () => withStore((store) => {
    const first = store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
    const removed = store.removeNote("rule", first.version)
    const next = store.saveNote("rule", { title: "Rule", topic: "build", content: "Second." })
    store.removeNote("rule", next.version)
    expect(() => store.restoreNote("rule", next.version, removed.version)).toThrow("changed")
  }))

  it("restores task metadata and description together", () => withStore((store) => {
    const first = store.saveTask("T", { title: "Original", status: "blocked", description: "Keep the blocker." })
    const next = store.saveTask("T", { title: "Wrong", status: "done", description: "Lost." }, first.version)
    store.restoreTask("T", first.version, next.version)
    expect(store.getTask("T")).toMatchObject({ title: "Original", status: "blocked", description: "Keep the blocker.", version: 3 })
  }))

  it("rejects a historical version from a different record", () => withStore((store) => {
    const first = store.saveNote("A", { title: "A", topic: "build", content: "First." })
    const other = store.saveNote("B", { title: "B", topic: "build", content: "Other." })
    expect(() => store.restoreNote("B", first.version, other.version)).toThrow("version not found")
  }))
})

describe("verified standalone backups", () => {
  it("restores current state and history from a backup while the source is open", () => {
    const source = openProjectMemory(project())
    try {
      const first = source.store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
      const next = source.store.saveNote("rule", { content: "Second." }, first.version)
      const backup = source.store.backup()
      const target = project()
      mkdirSync(join(target, ".opencode", "memory"), { recursive: true })
      copyFileSync(backup.path, join(target, ".opencode", "memory", "memory.db"))
      const recovered = openProjectMemory(target)
      try {
        recovered.store.restoreNote("rule", first.version, next.version)
        expect(recovered.store.getNote("rule")?.content).toBe("First.")
      } finally {
        recovered.store.close()
      }
    } finally {
      source.store.close()
    }
  })

  it("creates a standalone backup without WAL sidecars", () => withStore((store) => {
    store.saveTask("T", { title: "Task" })
    const backup = store.backup()
    expect(existsSync(`${backup.path}-wal`)).toBe(false)
    expect(existsSync(`${backup.path}-shm`)).toBe(false)
    const copy = openSqlite(backup.path, true)
    try {
      expect(copy.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
    } finally {
      copy.close()
    }
  }))
})

describe("bounded recovery history", () => {
  it("drops obsolete removal markers when migrating recreated knowledge", () => {
    const directory = project()
    const memory = openProjectMemory(directory)
    const database = openSqlite(memory.path)
    let lastVersion: number
    let previousVersion: number
    try {
      const first = memory.store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
      const removed = memory.store.removeNote("rule", first.version)
      const recreated = memory.store.saveNote("rule", { title: "Rule", topic: "build", content: "Second." })
      const last = memory.store.saveNote("rule", { content: "Third." }, recreated.version)
      previousVersion = recreated.version
      lastVersion = last.version
      database.prepare("INSERT INTO memory_revisions VALUES ('knowledge', 'rule', ?, 'remove', '{}', 1)").run(removed.version)
      database.exec("PRAGMA user_version=3")
    } finally {
      database.close()
      memory.store.close()
    }
    const upgraded = openProjectMemory(directory)
    try {
      expect(upgraded.store.listRevisions("knowledge", "rule").map(({ version, operation }) => ({ version, operation }))).toEqual([
        { version: lastVersion, operation: "save" },
        { version: previousVersion, operation: "save" },
      ])
    } finally {
      upgraded.store.close()
    }
  })

  it("rolls back schema 3 pruning failures while preserving the verified backup", () => {
    const directory = project()
    const memory = openProjectMemory(directory)
    const path = memory.path
    const database = openSqlite(path)
    let original: Buffer
    let originalRevisions: unknown[]
    try {
      const first = memory.store.saveTask("T", { title: "Task", description: "First." })
      const archived = asRecord(database.prepare("SELECT * FROM memory_revisions WHERE entity = 'task' AND entity_id = 'T'").get())
      const next = memory.store.saveTask("T", { description: "Second." }, first.version)
      memory.store.saveTask("T", { description: "Third." }, next.version)
      database.prepare("INSERT INTO memory_revisions VALUES (?, ?, ?, ?, ?, ?)")
        .run(archived.entity, archived.entity_id, archived.version, archived.operation, archived.snapshot, archived.recorded_at)
      database.exec(`
        PRAGMA user_version=3;
        CREATE TRIGGER reject_revision_pruning BEFORE DELETE ON memory_revisions
        BEGIN SELECT RAISE(ABORT, 'Retention failed'); END;
      `)
      original = Buffer.from(database.serialize())
      originalRevisions = database.prepare("SELECT * FROM memory_revisions ORDER BY version").all()
    } finally {
      database.close()
      memory.store.close()
    }
    expect(() => openProjectMemory(directory)).toThrow("Retention failed")
    const unchanged = openSqlite(path, true)
    try {
      expect(Buffer.from(unchanged.serialize()).equals(original)).toBe(true)
    } finally {
      unchanged.close()
    }
    const backupName = readdirSync(join(directory, ".opencode", "memory")).find((name) => name.endsWith(".bak"))
    if (!backupName) throw new Error("Expected a pre-migration backup")
    const backup = openSqlite(join(directory, ".opencode", "memory", backupName), true)
    try {
      expect(backup.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
      expect(backup.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 })
      expect(backup.prepare("SELECT * FROM memory_revisions ORDER BY version").all()).toEqual(originalRevisions)
    } finally {
      backup.close()
    }
  })

  it("rolls back the current record and recovery data if retention fails", () => {
    const memory = openProjectMemory(project())
    const database = openSqlite(memory.path)
    try {
      const first = memory.store.saveNote("rule", { title: "Rule", topic: "build", content: "First." })
      const second = memory.store.saveNote("rule", { content: "Second." }, first.version)
      database.exec(`
        CREATE TRIGGER reject_revision_pruning BEFORE DELETE ON memory_revisions
        BEGIN SELECT RAISE(ABORT, 'Retention failed'); END;
      `)
      expect(() => memory.store.saveNote("rule", { content: "Third." }, second.version)).toThrow("Retention failed")
      expect(memory.store.getNote("rule")).toMatchObject({ content: "Second.", version: second.version })
      expect(memory.store.listRevisions("knowledge", "rule").map(({ version }) => version)).toEqual([second.version, first.version])
    } finally {
      database.close()
      memory.store.close()
    }
  })

  it.each([false, true])("bounds existing schema 3 history after a verified backup (removed=%j)", (removed) => {
    const directory = project()
    const memory = openProjectMemory(directory)
    const database = openSqlite(memory.path)
    const archived: Record<string, unknown>[] = []
    const versions: number[] = []
    let removalVersion: number | undefined
    try {
      let version: number | undefined
      for (const content of ["First.", "Second.", "Third."]) {
        const saved = memory.store.saveNote("rule", { title: "Rule", topic: "build", content }, version)
        version = saved.version
        versions.push(version)
        archived.push(asRecord(database.prepare("SELECT * FROM memory_revisions WHERE entity = 'knowledge' AND entity_id = 'rule' AND version = ?").get(version)))
      }
      if (removed) removalVersion = memory.store.removeNote("rule", versions[2]!).version
      for (const row of archived) {
        database.prepare("INSERT OR IGNORE INTO memory_revisions(entity, entity_id, version, operation, snapshot, recorded_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(row.entity, row.entity_id, row.version, row.operation, row.snapshot, row.recorded_at)
      }
      if (removed) database.prepare("UPDATE memory_revisions SET snapshot = ? WHERE operation = 'remove'").run(archived[2]!.snapshot)
      database.exec("PRAGMA user_version=3")
    } finally {
      database.close()
      memory.store.close()
    }
    const upgraded = openProjectMemory(directory)
    try {
      expect(upgraded.store.migrationBackup).not.toBeNull()
      expect(upgraded.store.listRevisions("knowledge", "rule").map(({ version }) => version)).toEqual(
        removed ? [removalVersion!, versions[2]!] : [versions[2]!, versions[1]!],
      )
      expect(() => upgraded.store.getNoteRevision("rule", versions[0]!)).toThrow("version not found")
      const backup = openSqlite(upgraded.store.migrationBackup!, true)
      try {
        expect(asRecord(backup.prepare("SELECT count(*) AS count FROM memory_revisions").get()).count).toBe(removed ? 4 : 3)
      } finally {
        backup.close()
      }
      if (removed) {
        upgraded.store.restoreNote("rule", versions[2]!, removalVersion!)
        expect(upgraded.store.getNote("rule")?.content).toBe("Third.")
      } else {
        expect(upgraded.store.getNote("rule")).toMatchObject({ content: "Third.", version: versions[2]! })
      }
    } finally {
      upgraded.store.close()
    }
  })
})

describe("schema 2 upgrade", () => {
  it("backs up existing data and seeds restorable history and search", () => {
    const directory = project()
    const path = join(directory, ".opencode", "memory")
    mkdirSync(path, { recursive: true })
    const database = openSqlite(join(path, "memory.db"))
    database.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, description TEXT, version INTEGER, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE knowledge (version INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, topic TEXT, title TEXT, content TEXT, updated_at INTEGER);
      INSERT INTO tasks VALUES ('T', 'Task', 'blocked', 'Original', 7, 1, 2);
      INSERT INTO knowledge VALUES (12, 'rule', 'build', 'Original', 'Heap ceiling is 6 GiB.', 2);
      PRAGMA user_version=2;
    `)
    database.close()
    const upgraded = openProjectMemory(directory)
    try {
      expect(upgraded.store.migrationBackup).not.toBeNull()
      expect(upgraded.store.listNotes({ query: "heap GiB" })[0].version).toBe(12)
      const next = upgraded.store.saveTask("T", { description: "Changed" }, 7)
      upgraded.store.restoreTask("T", 7, next.version)
      expect(upgraded.store.getTask("T")?.description).toBe("Original")
    } finally {
      upgraded.store.close()
    }
    expect(readdirSync(path).filter((name) => name.endsWith(".bak"))).toHaveLength(1)
  })
})
