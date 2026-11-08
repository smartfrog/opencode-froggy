import { asRecord } from "../record"
import { backupDatabase } from "./backup"
import { BOUNDED_HISTORY_MIGRATION, MEMORY_SCHEMA_VERSION, RELIABILITY_SCHEMA } from "./reliability-schema"
import { type SqliteDatabase } from "./sqlite"

const SCHEMA = `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('todo', 'in-progress', 'blocked', 'review', 'done')),
    description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE knowledge (
    version INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE, topic TEXT NOT NULL, title TEXT NOT NULL,
    content TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_knowledge_topic ON knowledge(topic);
  PRAGMA user_version=2;
`

function section(title: string, value: unknown): string {
  if (value == null || value === "") return ""
  if (typeof value !== "string") throw new Error(`Invalid legacy ${title}`)
  return `## ${title}\n\n${value}`
}

function references(title: string, value: unknown): string {
  if (typeof value !== "string") throw new Error(`Invalid legacy ${title}`)
  const items: unknown = JSON.parse(value)
  if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) throw new Error(`Invalid legacy ${title}`)
  return items.length ? section(title, items.map((item) => `- ${item}`).join("\n")) : ""
}

function label(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid legacy label")
  return Array.from(value).slice(0, maximum).join("")
}

function originalLabel(title: string, value: unknown, maximum: number): string {
  return typeof value === "string" && Array.from(value).length > maximum ? section(title, value) : ""
}

export function initializeMemory(database: SqliteDatabase, path?: string, readonly = false): string | null {
  if (readonly) {
    const version = Number(asRecord(database.prepare("PRAGMA user_version").get()).user_version)
    if (version !== MEMORY_SCHEMA_VERSION) throw new Error("A read requires the current memory schema; upgrade it separately before reading")
    return null
  }
  database.exec("BEGIN IMMEDIATE")
  try {
    const version = Number(asRecord(database.prepare("PRAGMA user_version").get()).user_version)
    if (version > MEMORY_SCHEMA_VERSION) throw new Error(`Unsupported memory schema version: ${version}`)
    const columns = database.prepare("PRAGMA table_info(tasks)").all().map((row) => asRecord(row).name)
    let savedBackup: string | null = null
    if (columns.includes("objective")) {
      savedBackup = backupDatabase(database, path ?? "", "pre-simple").path
      const tasks = database.prepare("SELECT * FROM tasks ORDER BY id").all().map(asRecord)
      const notes = database.prepare("SELECT * FROM notes WHERE status = 'active' ORDER BY id").all().map(asRecord)
      const descriptions = tasks.map((row) => [
        originalLabel("Original title", row.title, 200),
        section("Objective", row.objective), section("Acceptance", row.acceptance),
        section("Current state", row.current_state), section("Next action", row.next_action),
        section("Blockers", row.blockers), references("Knowledge", row.knowledge_refs),
        references("Evidence", row.evidence), references("Assignments", row.assignments),
        row.status === "archived" ? section("Migration", "Previously archived; mapped to done.") : "",
      ].filter(Boolean).join("\n\n"))
      const contents = notes.map((row) => [
        section("Knowledge", row.content), references("Sources", row.sources),
        originalLabel("Original title", row.title, 200), originalLabel("Original topic", row.topic, 80),
      ].filter(Boolean).join("\n\n"))
      database.exec("DROP TABLE history; DROP TABLE notes; DROP TABLE tasks;")
      database.exec(SCHEMA)
      for (const [index, row] of tasks.entries()) {
        database.prepare("INSERT INTO tasks (id, title, status, description, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(row.id, label(row.title, 200), row.status === "archived" ? "done" : row.status, descriptions[index], 1, row.updated_at, row.updated_at)
      }
      for (const [index, row] of notes.entries()) {
        database.prepare("INSERT INTO knowledge (id, topic, title, content, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(row.id, label(row.topic, 80), label(row.title, 200), contents[index], row.updated_at)
      }
      if (Number(asRecord(database.prepare("SELECT count(*) AS count FROM tasks").get()).count) !== tasks.length
        || Number(asRecord(database.prepare("SELECT count(*) AS count FROM knowledge").get()).count) !== notes.length) {
        throw new Error("Memory migration count verification failed")
      }
    } else if (columns.length === 0) {
      database.exec(SCHEMA)
    } else if (![2, 3, MEMORY_SCHEMA_VERSION].includes(version) || !columns.includes("description")) {
      throw new Error("Unrecognized memory schema; no changes were made")
    }
    if (version === 3) {
      savedBackup = backupDatabase(database, path ?? "", "pre-bounded-history").path
      for (const statement of BOUNDED_HISTORY_MIGRATION) database.exec(statement)
    } else if (version !== MEMORY_SCHEMA_VERSION) {
      if (version === 2 && !savedBackup) savedBackup = backupDatabase(database, path ?? "", "pre-reliability").path
      database.exec(RELIABILITY_SCHEMA)
    }
    database.exec("COMMIT")
    return savedBackup
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}
