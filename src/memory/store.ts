import { asRecord } from "../record"
import { backupDatabase } from "./backup"
import { initializeMemory } from "./migration"
import { type SqliteDatabase } from "./sqlite"

export const TASK_STATUSES = ["todo", "in-progress", "review", "blocked", "done"] as const
export type TaskStatus = typeof TASK_STATUSES[number]

export interface TaskRecord {
  id: string
  title: string
  status: TaskStatus
  description: string
  version: number
  createdAt: number
  updatedAt: number
}

export interface NoteRecord {
  id: string
  topic: string
  title: string
  content: string
  version: number
  updatedAt: number
  excerpt?: string
}

export type MemoryEntity = "task" | "knowledge"

export interface RevisionSummary {
  version: number
  operation: "save" | "remove"
  recordedAt: number
}

export interface TaskPatch {
  title?: string
  status?: string
  description?: string
}

export interface NotePatch {
  topic?: string
  title?: string
  content?: string
}

export interface SaveResult {
  id: string
  version: number
  created: boolean
}

export function assertId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error("Invalid id: use up to 128 letters, numbers, dots, underscores or dashes")
  }
  return value
}

function requiredText(value: unknown, field: string, maximum?: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  if (maximum !== undefined && Array.from(value).length > maximum) throw new Error(`${field} must not exceed ${maximum} characters`)
  return value.trim()
}

function taskStatus(value: string): TaskStatus {
  if (!TASK_STATUSES.includes(value as TaskStatus)) throw new Error(`Invalid task status: ${value}`)
  return value as TaskStatus
}

function mapTask(value: unknown): TaskRecord {
  const row = asRecord(value)
  return {
    id: String(row.id), title: String(row.title), status: taskStatus(String(row.status)),
    description: String(row.description), version: Number(row.version),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

function mapNote(value: unknown): NoteRecord {
  const row = asRecord(value)
  return {
    id: String(row.id), topic: String(row.topic), title: String(row.title),
    content: String(row.content), version: Number(row.version), updatedAt: Number(row.updated_at),
  }
}

function checkVersion(id: string, current: { version: number } | null, expected: number | null): void {
  if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) throw new Error("expectedVersion must be a positive integer")
  if (!current) {
    if (expected !== null) throw new Error(`Record ${id} does not exist; omit expectedVersion to create it`)
    return
  }
  if (expected === null) throw new Error(`Record ${id} already exists; provide expectedVersion`)
  if (current.version !== expected) throw new Error(`Record ${id} changed: expected version ${expected}, current ${current.version}`)
}

export class MemoryStore {
  readonly migrationBackup: string | null

  constructor(private readonly database: SqliteDatabase, private readonly path?: string, readonly = false) {
    this.migrationBackup = initializeMemory(database, path, readonly)
  }

  close(): void {
    this.database.close()
  }

  private transaction<T>(operation: () => T, write = true): T {
    this.database.exec(write ? "BEGIN IMMEDIATE" : "BEGIN")
    try {
      const result = operation()
      this.database.exec("COMMIT")
      return result
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }

  getTask(id: string): TaskRecord | null {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(assertId(id))
    return row == null ? null : mapTask(row)
  }

  taskCounts(): { status: TaskStatus; count: number }[] {
    const rows = this.database.prepare("SELECT status, count(*) AS count FROM tasks GROUP BY status").all()
    const counts = new Map<TaskStatus, number>(TASK_STATUSES.map((status): [TaskStatus, number] => [status, 0]))
    for (const row of rows) {
      const record = asRecord(row)
      counts.set(taskStatus(String(record.status)), Number(record.count))
    }
    return TASK_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }))
  }

  listTasks(statuses: readonly TaskStatus[] = TASK_STATUSES): TaskRecord[] {
    if (statuses.length === 0) return []
    const placeholders = statuses.map(() => "?").join(", ")
    return this.database.prepare(`SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY updated_at DESC, id`)
      .all(...statuses.map(taskStatus)).map(mapTask)
  }

  saveTask(id: string, patch: TaskPatch, expectedVersion: number | null = null): SaveResult {
    assertId(id)
    return this.transaction(() => this.writeTask(id, patch, expectedVersion))
  }

  private writeTask(id: string, patch: TaskPatch, expectedVersion: number | null): SaveResult {
    const current = this.getTask(id)
    checkVersion(id, current, expectedVersion)
    const title = requiredText(patch.title ?? current?.title, "title", 200)
    const status = taskStatus(patch.status ?? current?.status ?? "todo")
    const description = patch.description ?? current?.description ?? ""
    if (typeof description !== "string") throw new Error("Invalid description")
    const now = Date.now()
    const version = (current?.version ?? 0) + 1
    const result = current
      ? this.database.prepare("UPDATE tasks SET title = ?, status = ?, description = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?")
        .run(title, status, description, version, now, id, current.version)
      : this.database.prepare("INSERT INTO tasks (id, title, status, description, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, title, status, description, version, now, now)
    if (Number(result.changes) !== 1) throw new Error(`Task ${id} changed; read it again`)
    this.recordRevision("task", id, "save")
    return { id, version, created: current === null }
  }

  getNote(id: string): NoteRecord | null {
    const row = this.database.prepare("SELECT * FROM knowledge WHERE id = ?").get(assertId(id))
    return row == null ? null : mapNote(row)
  }

  listNotes(options: { query?: string; topic?: string } = {}): NoteRecord[] {
    if (options.query !== undefined) {
      const query = requiredText(options.query, "query").split(/\s+/u)
        .map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ")
      const topicFilter = options.topic === undefined ? "" : "AND k.topic = ?"
      return this.database.prepare(`
        SELECT k.*, snippet(knowledge_search, 3, '', '', '…', 40) AS excerpt
        FROM knowledge_search JOIN knowledge k ON k.version = knowledge_search.rowid
        WHERE knowledge_search MATCH ? ${topicFilter}
        ORDER BY bm25(knowledge_search, 10, 5, 2, 1), k.topic, k.id
      `).all(...(options.topic === undefined ? [query] : [query, options.topic])).map((value) => ({
        ...mapNote(value), excerpt: String(asRecord(value).excerpt),
      }))
    }
    const topicFilter = options.topic === undefined ? "" : "WHERE topic = ?"
    const params = options.topic === undefined ? [] : [options.topic]
    return this.database.prepare(`SELECT * FROM knowledge ${topicFilter} ORDER BY topic, id`)
      .all(...params).map(mapNote)
  }

  knowledgeInventory(limit?: number, offset = 0) {
    return this.transaction(() => {
      const totals = asRecord(this.database.prepare("SELECT count(*) AS knowledge_count, count(DISTINCT topic) AS topic_count FROM knowledge").get())
      const pagination = limit === undefined ? "" : " LIMIT ? OFFSET ?"
      const topics = this.database.prepare(`SELECT topic, count(*) AS count FROM knowledge GROUP BY topic ORDER BY topic${pagination}`)
        .all(...(limit === undefined ? [] : [limit, offset])).map((value) => {
          const row = asRecord(value)
          return { topic: String(row.topic), count: Number(row.count) }
        })
      return { knowledgeCount: Number(totals.knowledge_count), topicCount: Number(totals.topic_count), topics }
    }, false)
  }

  saveNote(id: string, patch: NotePatch, expectedVersion: number | null = null): SaveResult {
    assertId(id)
    return this.transaction(() => this.writeNote(id, patch, expectedVersion))
  }

  private writeNote(id: string, patch: NotePatch, expectedVersion: number | null): SaveResult {
    const current = this.getNote(id)
    checkVersion(id, current, expectedVersion)
    const topic = requiredText(patch.topic ?? current?.topic, "topic", 80)
    const title = requiredText(patch.title ?? current?.title, "title", 200)
    const content = patch.content ?? current?.content ?? ""
    requiredText(content, "content")
    const result = this.database.prepare(`
      INSERT INTO knowledge (id, topic, title, content, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, title = excluded.title,
        content = excluded.content, version = excluded.version, updated_at = excluded.updated_at
      WHERE knowledge.version = ? RETURNING version
    `).get(id, topic, title, content, Date.now(), expectedVersion)
    if (!result) throw new Error(`Knowledge ${id} changed; read it again`)
    this.recordRevision("knowledge", id, "save")
    return { id, version: Number(asRecord(result).version), created: current === null }
  }

  removeNote(id: string, expectedVersion: number): { id: string; removed: true; version: number } {
    assertId(id)
    return this.transaction(() => {
      const current = this.getNote(id)
      if (!current) throw new Error(`Knowledge not found: ${id}`)
      checkVersion(id, current, expectedVersion)
      const generation = this.database.prepare("UPDATE sqlite_sequence SET seq = seq + 1 WHERE name = 'knowledge' RETURNING seq").get()
      const version = Number(asRecord(generation).seq)
      if (!Number.isSafeInteger(version) || version <= expectedVersion) throw new Error("Cannot allocate a knowledge removal version")
      this.recordRevision("knowledge", id, "remove", version)
      const result = this.database.prepare("DELETE FROM knowledge WHERE id = ? AND version = ? RETURNING version").get(id, expectedVersion)
      if (!result) throw new Error(`Knowledge ${id} changed; read it again`)
      return { id, removed: true, version }
    })
  }

  private recordRevision(entity: MemoryEntity, id: string, operation: RevisionSummary["operation"], version?: number): void {
    const table = entity === "task" ? "tasks" : "knowledge"
    const row = this.database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
    if (!row) throw new Error(`Cannot record missing ${entity}: ${id}`)
    this.database.prepare(`
      INSERT INTO memory_revisions(entity, entity_id, version, operation, snapshot, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entity, id, version ?? asRecord(row).version, operation, operation === "remove" ? "{}" : JSON.stringify(row), Date.now())
    if (operation === "save") {
      this.database.prepare("DELETE FROM memory_revisions WHERE entity = ? AND entity_id = ? AND operation = 'remove'").run(entity, id)
    }
    this.database.prepare(`
      DELETE FROM memory_revisions WHERE entity = ? AND entity_id = ? AND version NOT IN (
        SELECT version FROM memory_revisions WHERE entity = ? AND entity_id = ? ORDER BY version DESC LIMIT 2
      )
    `).run(entity, id, entity, id)
  }

  listRevisions(entity: MemoryEntity, id: string): RevisionSummary[] {
    return this.database.prepare(`
      SELECT version, operation, recorded_at FROM memory_revisions
      WHERE entity = ? AND entity_id = ? ORDER BY version DESC
    `).all(entity, assertId(id)).map((value) => {
      const row = asRecord(value)
      if (row.operation !== "save" && row.operation !== "remove") throw new Error("Invalid revision operation")
      return { version: Number(row.version), operation: row.operation, recordedAt: Number(row.recorded_at) }
    })
  }

  private revisionSnapshot(entity: MemoryEntity, id: string, version: number): unknown {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error("version must be a positive integer")
    const row = this.database.prepare(`
      SELECT snapshot FROM memory_revisions WHERE entity = ? AND entity_id = ? AND version = ? AND operation = 'save'
    `).get(entity, assertId(id), version)
    if (!row) throw new Error(`Historical version not found: ${entity} ${id} version ${version}`)
    return JSON.parse(String(asRecord(row).snapshot)) as unknown
  }

  getTaskRevision(id: string, version: number): TaskRecord {
    return mapTask(this.revisionSnapshot("task", id, version))
  }

  getNoteRevision(id: string, version: number): NoteRecord {
    return mapNote(this.revisionSnapshot("knowledge", id, version))
  }

  restoreTask(id: string, version: number, expectedVersion: number): SaveResult {
    return this.transaction(() => this.writeTask(id, this.getTaskRevision(id, version), expectedVersion))
  }

  restoreNote(id: string, version: number, expectedVersion: number): SaveResult {
    return this.transaction(() => {
      const current = this.getNote(id)
      if (current) {
        checkVersion(id, current, expectedVersion)
      } else {
        const latest = this.listRevisions("knowledge", id)[0]
        if (latest?.operation !== "remove" || latest.version !== expectedVersion) throw new Error(`Knowledge ${id} changed; read its history again`)
      }
      const snapshot = this.getNoteRevision(id, version)
      return this.writeNote(id, snapshot, current ? expectedVersion : null)
    })
  }

  backup(): { path: string; bytes: number } {
    return this.transaction(() => backupDatabase(this.database, this.path ?? ""), false)
  }
}
