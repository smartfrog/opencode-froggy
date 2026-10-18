import { asRecord } from "../record"
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

export interface TaskNote {
  id: number
  taskId: string
  note: string
  createdAt: number
}

export interface NoteRecord {
  id: string
  topic: string
  title: string
  content: string
  version: number
  updatedAt: number
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

  constructor(private readonly database: SqliteDatabase, path?: string, readonly = false) {
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

  listTasks(status?: string, limit = 21, offset = 0): TaskRecord[] {
    const rows = status === undefined
      ? this.database.prepare("SELECT * FROM tasks ORDER BY updated_at DESC, id LIMIT ? OFFSET ?").all(limit, offset)
      : this.database.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY updated_at DESC, id LIMIT ? OFFSET ?").all(taskStatus(status), limit, offset)
    return rows.map(mapTask)
  }

  saveTask(id: string, patch: TaskPatch, expectedVersion: number | null = null): SaveResult {
    assertId(id)
    return this.transaction(() => {
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
      return { id, version, created: current === null }
    })
  }

  addTaskNote(id: string, note: string, expectedVersion: number | null = null): { note: TaskNote; version: number } {
    assertId(id)
    const value = requiredText(note, "note", 500)
    return this.transaction(() => {
      const task = this.getTask(id)
      if (!task) throw new Error(`Task not found: ${id}`)
      if (expectedVersion !== null) checkVersion(id, task, expectedVersion)
      const createdAt = Date.now()
      const result = this.database.prepare("INSERT INTO task_notes (task_id, note, created_at) VALUES (?, ?, ?)").run(id, value, createdAt)
      if (Number(result.changes) !== 1) throw new Error(`Progress note for ${id} could not be saved`)
      const update = this.database.prepare("UPDATE tasks SET updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").run(createdAt, id, task.version)
      if (Number(update.changes) !== 1) throw new Error(`Task ${id} changed; progress note was not saved`)
      return { note: { id: Number(result.lastInsertRowid), taskId: id, note: value, createdAt }, version: task.version + 1 }
    })
  }

  taskNotes(id: string, limit = 11, offset = 0): TaskNote[] {
    return this.database.prepare("SELECT * FROM task_notes WHERE task_id = ? ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(assertId(id), limit, offset).map((value) => {
        const row = asRecord(value)
        return { id: Number(row.id), taskId: String(row.task_id), note: String(row.note), createdAt: Number(row.created_at) }
      })
  }

  getTaskWithNotes(id: string): { task: TaskRecord; notes: TaskNote[] } {
    return this.transaction(() => {
      const task = this.getTask(id)
      if (!task) throw new Error(`Task not found: ${id}`)
      return { task, notes: this.taskNotes(id, -1) }
    }, false)
  }

  getNote(id: string): NoteRecord | null {
    const row = this.database.prepare("SELECT * FROM knowledge WHERE id = ?").get(assertId(id))
    return row == null ? null : mapNote(row)
  }

  listNotes(options: { query?: string; topic?: string; limit?: number; offset?: number } = {}): NoteRecord[] {
    const filters: string[] = []
    const params: unknown[] = []
    if (options.query !== undefined) {
      filters.push("instr(lower(topic || ' ' || title || ' ' || content), lower(?)) > 0")
      params.push(requiredText(options.query, "query"))
    }
    if (options.topic !== undefined) {
      filters.push("topic = ?")
      params.push(options.topic)
    }
    return this.database.prepare(`SELECT * FROM knowledge ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY topic, id LIMIT ? OFFSET ?`)
      .all(...params, options.limit ?? 21, options.offset ?? 0).map(mapNote)
  }

  knowledgeInventory(limit: number, offset: number) {
    return this.transaction(() => {
      const totals = asRecord(this.database.prepare("SELECT count(*) AS knowledge_count, count(DISTINCT topic) AS topic_count FROM knowledge").get())
      const topics = this.database.prepare("SELECT topic, count(*) AS count FROM knowledge GROUP BY topic ORDER BY topic LIMIT ? OFFSET ?")
        .all(limit, offset).map((value) => {
          const row = asRecord(value)
          return { topic: String(row.topic), count: Number(row.count) }
        })
      return { knowledgeCount: Number(totals.knowledge_count), topicCount: Number(totals.topic_count), topics }
    }, false)
  }

  saveNote(id: string, patch: NotePatch, expectedVersion: number | null = null): SaveResult {
    assertId(id)
    return this.transaction(() => {
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
        WHERE knowledge.version = ?
      `).run(id, topic, title, content, Date.now(), expectedVersion)
      if (Number(result.changes) !== 1) throw new Error(`Knowledge ${id} changed; read it again`)
      const saved = this.getNote(id)
      if (!saved) throw new Error(`Knowledge ${id} could not be saved`)
      return { id, version: saved.version, created: current === null }
    })
  }

  removeNote(id: string, expectedVersion: number): { id: string; removed: true } {
    assertId(id)
    return this.transaction(() => {
      const current = this.getNote(id)
      if (!current) throw new Error(`Knowledge not found: ${id}`)
      checkVersion(id, current, expectedVersion)
      const result = this.database.prepare("DELETE FROM knowledge WHERE id = ? AND version = ?").run(id, expectedVersion)
      if (Number(result.changes) !== 1) throw new Error(`Knowledge ${id} changed; read it again`)
      return { id, removed: true }
    })
  }
}
