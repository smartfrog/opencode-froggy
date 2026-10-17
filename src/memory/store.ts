import { asRecord } from "../record"
import { type SqliteDatabase } from "./sqlite"

export const TASK_STATUSES = ["todo", "in-progress", "blocked", "review", "done", "archived"] as const
export const NOTE_KINDS = ["constraint", "decision", "fact", "lesson"] as const
export const NOTE_STATUSES = ["active", "superseded"] as const

export type TaskStatus = typeof TASK_STATUSES[number]
export type NoteKind = typeof NOTE_KINDS[number]
export type NoteStatus = typeof NOTE_STATUSES[number]

export interface TaskRecord {
  id: string
  title: string
  status: TaskStatus
  objective: string
  acceptance: string
  currentState: string
  nextAction: string
  blockers: string
  knowledgeRefs: string[]
  evidence: string[]
  assignments: string[]
  revision: number
  updatedAt: number
  updatedBy: string
  updatedSession: string
}

export interface NoteRecord {
  id: string
  topic: string
  kind: NoteKind
  title: string
  content: string
  sources: string[]
  status: NoteStatus
  supersededBy: string | null
  revision: number
  updatedAt: number
  updatedBy: string
  updatedSession: string
}

export interface HistoryRecord {
  entity: "task" | "note"
  entityId: string
  revision: number
  snapshot: unknown
  archivedAt: number
  archivedBy: string
}

export interface TaskPatch {
  title?: string
  status?: string
  objective?: string
  acceptance?: string
  currentState?: string
  nextAction?: string
  blockers?: string
  knowledgeRefs?: string[]
  evidence?: string[]
  assignments?: string[]
}

export interface NotePatch {
  topic?: string
  kind?: string
  title?: string
  content?: string
  sources?: string[]
  status?: string
  supersededBy?: string | null
}

export interface SaveResult {
  id: string
  revision: number
  created: boolean
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`Invalid ${field}`)
  return value
}

const optionalText = (value: unknown): string => typeof value === "string" ? value : ""

const number = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Invalid ${field}`)
  return value
}

const strings = (value: unknown, field: string): string[] => {
  if (typeof value !== "string") throw new Error(`Invalid ${field}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid ${field}`, { cause: error })
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error(`Invalid ${field}`)
  return parsed
}

const json = (value: string[]): string => JSON.stringify(value)

function assertId(value: string, field: string): string {
  if (!ID.test(value)) throw new Error(`Invalid ${field}: use letters, numbers, dot, underscore or dash`)
  return value
}

function assertStatus(value: string): TaskStatus {
  if (!TASK_STATUSES.includes(value as TaskStatus)) throw new Error(`Invalid task status: ${value}`)
  return value as TaskStatus
}

function assertKind(value: string): NoteKind {
  if (!NOTE_KINDS.includes(value as NoteKind)) throw new Error(`Invalid note kind: ${value}`)
  return value as NoteKind
}

function assertNoteStatus(value: string): NoteStatus {
  if (!NOTE_STATUSES.includes(value as NoteStatus)) throw new Error(`Invalid note status: ${value}`)
  return value as NoteStatus
}

function mapTask(value: unknown): TaskRecord {
  const row = asRecord(value)
  return {
    id: text(row.id, "task id"),
    title: text(row.title, "task title"),
    status: assertStatus(text(row.status, "task status")),
    objective: optionalText(row.objective),
    acceptance: optionalText(row.acceptance),
    currentState: optionalText(row.current_state),
    nextAction: optionalText(row.next_action),
    blockers: optionalText(row.blockers),
    knowledgeRefs: strings(row.knowledge_refs, "task knowledge_refs"),
    evidence: strings(row.evidence, "task evidence"),
    assignments: strings(row.assignments, "task assignments"),
    revision: number(row.revision, "task revision"),
    updatedAt: number(row.updated_at, "task updated_at"),
    updatedBy: optionalText(row.updated_by),
    updatedSession: optionalText(row.updated_session),
  }
}

function mapNote(value: unknown): NoteRecord {
  const row = asRecord(value)
  return {
    id: text(row.id, "note id"),
    topic: text(row.topic, "note topic"),
    kind: assertKind(text(row.kind, "note kind")),
    title: text(row.title, "note title"),
    content: text(row.content, "note content"),
    sources: strings(row.sources, "note sources"),
    status: assertNoteStatus(text(row.status, "note status")),
    supersededBy: typeof row.superseded_by === "string" ? row.superseded_by : null,
    revision: number(row.revision, "note revision"),
    updatedAt: number(row.updated_at, "note updated_at"),
    updatedBy: optionalText(row.updated_by),
    updatedSession: optionalText(row.updated_session),
  }
}

function mapHistory(value: unknown): HistoryRecord {
  const row = asRecord(value)
  const entity = text(row.entity, "history entity")
  if (entity !== "task" && entity !== "note") throw new Error("Invalid history entity")
  return {
    entity,
    entityId: text(row.entity_id, "history entity_id"),
    revision: number(row.revision, "history revision"),
    snapshot: JSON.parse(text(row.snapshot, "history snapshot")) as unknown,
    archivedAt: number(row.archived_at, "history archived_at"),
    archivedBy: optionalText(row.archived_by),
  }
}

export class MemoryStore {
  constructor(private readonly database: SqliteDatabase) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        acceptance TEXT NOT NULL DEFAULT '',
        current_state TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        blockers TEXT NOT NULL DEFAULT '',
        knowledge_refs TEXT NOT NULL DEFAULT '[]',
        evidence TEXT NOT NULL DEFAULT '[]',
        assignments TEXT NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        updated_session TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        sources TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        superseded_by TEXT,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        updated_session TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        archived_at INTEGER NOT NULL,
        archived_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_topic ON notes(topic);
      CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
      CREATE INDEX IF NOT EXISTS idx_history_entity ON history(entity, entity_id, revision);
    `)
  }

  close(): void {
    this.database.close()
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const result = operation()
      this.database.exec("COMMIT")
      return result
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }

  private archive(entity: "task" | "note", entityId: string, revision: number, snapshot: unknown, actor: string, now: number): void {
    this.database.prepare(
      "INSERT INTO history (entity, entity_id, revision, snapshot, archived_at, archived_by) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(entity, entityId, revision, JSON.stringify(snapshot), now, actor)
  }

  getTask(id: string): TaskRecord | null {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(assertId(id, "task id"))
    return row === undefined || row === null ? null : mapTask(row)
  }

  listTasks(status?: string, limit = 20, offset = 0): TaskRecord[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const safeOffset = Math.max(Math.trunc(offset), 0)
    const rows = status === undefined
      ? this.database.prepare("SELECT * FROM tasks WHERE status != 'archived' ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(safeLimit, safeOffset)
      : this.database.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(assertStatus(status), safeLimit, safeOffset)
    return rows.map(mapTask)
  }

  saveTask(
    id: string,
    patch: TaskPatch,
    actor: string,
    session: string,
    expectedRevision: number | null = null,
  ): SaveResult {
    assertId(id, "task id")
    const now = Date.now()
    return this.transaction(() => {
      const current = this.getTask(id)
      if (current === null) {
        if (expectedRevision !== null) throw new Error("Task does not exist; omit expectedRevision to create it")
        if (!patch.title?.trim()) throw new Error("A title is required to create a task")
        const task: TaskRecord = {
          id,
          title: patch.title.trim(),
          status: patch.status === undefined ? "todo" : assertStatus(patch.status),
          objective: patch.objective ?? "",
          acceptance: patch.acceptance ?? "",
          currentState: patch.currentState ?? "",
          nextAction: patch.nextAction ?? "",
          blockers: patch.blockers ?? "",
          knowledgeRefs: patch.knowledgeRefs ?? [],
          evidence: patch.evidence ?? [],
          assignments: patch.assignments ?? [],
          revision: 1,
          updatedAt: now,
          updatedBy: actor,
          updatedSession: session,
        }
        const insert = this.database.prepare(`
          INSERT INTO tasks (
            id, title, status, objective, acceptance, current_state, next_action, blockers,
            knowledge_refs, evidence, assignments, revision, updated_at, updated_by, updated_session
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          task.id, task.title, task.status, task.objective, task.acceptance, task.currentState,
          task.nextAction, task.blockers, json(task.knowledgeRefs), json(task.evidence),
          json(task.assignments), task.revision, task.updatedAt, task.updatedBy, task.updatedSession,
        )
        if (Number(insert.changes) !== 1) throw new Error(`Task ${id} could not be created`)
        return { id, revision: 1, created: true }
      }

      if (expectedRevision === null) throw new Error(`Task ${id} already exists; provide expectedRevision`)
      if (current.revision !== expectedRevision) {
        throw new Error(`Task ${id} changed: expected revision ${expectedRevision}, current ${current.revision}`)
      }
      if (patch.title !== undefined && !patch.title.trim()) throw new Error("Task title cannot be empty")
      const next: TaskRecord = {
        ...current,
        ...patch,
        status: patch.status === undefined ? current.status : assertStatus(patch.status),
        revision: current.revision + 1,
        updatedAt: now,
        updatedBy: actor,
        updatedSession: session,
      }
      const update = this.database.prepare(`
        UPDATE tasks SET
          title = ?, status = ?, objective = ?, acceptance = ?, current_state = ?,
          next_action = ?, blockers = ?, knowledge_refs = ?, evidence = ?, assignments = ?,
          revision = ?, updated_at = ?, updated_by = ?, updated_session = ?
        WHERE id = ? AND revision = ?
      `).run(
        next.title, next.status, next.objective, next.acceptance, next.currentState,
        next.nextAction, next.blockers, json(next.knowledgeRefs), json(next.evidence),
        json(next.assignments), next.revision, next.updatedAt, next.updatedBy, next.updatedSession,
        id, current.revision,
      )
      if (Number(update.changes) !== 1) {
        throw new Error(`Task ${id} changed: expected revision ${current.revision}`)
      }
      this.archive("task", id, current.revision, current, actor, now)
      return { id, revision: next.revision, created: false }
    })
  }

  getNote(id: string): NoteRecord | null {
    const row = this.database.prepare("SELECT * FROM notes WHERE id = ?").get(assertId(id, "note id"))
    return row === undefined || row === null ? null : mapNote(row)
  }

  searchNotes(query: string, options: { topic?: string; kind?: string; limit?: number; offset?: number } = {}): NoteRecord[] {
    if (!query.trim()) throw new Error("A search query is required")
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 5), 1), 20)
    const offset = Math.max(Math.trunc(options.offset ?? 0), 0)
    const filters = ["status = 'active'", "instr(lower(topic || ' ' || title || ' ' || content), lower(?)) > 0"]
    const params: unknown[] = [query.trim()]
    if (options.topic) {
      filters.push("topic = ?")
      params.push(options.topic)
    }
    if (options.kind) {
      filters.push("kind = ?")
      params.push(assertKind(options.kind))
    }
    params.push(limit, offset)
    const rows = this.database.prepare(
      `SELECT * FROM notes WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    ).all(...params)
    return rows.map(mapNote)
  }

  saveNote(
    id: string,
    patch: NotePatch,
    actor: string,
    session: string,
    expectedRevision: number | null = null,
  ): SaveResult {
    assertId(id, "note id")
    if (patch.supersededBy !== undefined && patch.supersededBy !== null) {
      assertId(patch.supersededBy, "supersededBy")
    }
    const now = Date.now()
    return this.transaction(() => {
      const current = this.getNote(id)
      if (current === null) {
        if (expectedRevision !== null) throw new Error("Note does not exist; omit expectedRevision to create it")
        if (!patch.topic?.trim()) throw new Error("A topic is required to create a note")
        if (!patch.title?.trim()) throw new Error("A title is required to create a note")
        if (!patch.content?.trim()) throw new Error("Content is required to create a note")
        const note: NoteRecord = {
          id,
          topic: patch.topic.trim(),
          kind: patch.kind === undefined ? "fact" : assertKind(patch.kind),
          title: patch.title.trim(),
          content: patch.content,
          sources: patch.sources ?? [],
          status: patch.status === undefined ? "active" : assertNoteStatus(patch.status),
          supersededBy: patch.supersededBy ?? null,
          revision: 1,
          updatedAt: now,
          updatedBy: actor,
          updatedSession: session,
        }
        const insert = this.database.prepare(`
          INSERT INTO notes (
            id, topic, kind, title, content, sources, status, superseded_by,
            revision, updated_at, updated_by, updated_session
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          note.id, note.topic, note.kind, note.title, note.content, json(note.sources),
          note.status, note.supersededBy, note.revision, note.updatedAt, note.updatedBy, note.updatedSession,
        )
        if (Number(insert.changes) !== 1) throw new Error(`Note ${id} could not be created`)
        return { id, revision: 1, created: true }
      }

      if (expectedRevision === null) throw new Error(`Note ${id} already exists; provide expectedRevision`)
      if (current.revision !== expectedRevision) {
        throw new Error(`Note ${id} changed: expected revision ${expectedRevision}, current ${current.revision}`)
      }
      if (patch.topic !== undefined && !patch.topic.trim()) throw new Error("Note topic cannot be empty")
      if (patch.title !== undefined && !patch.title.trim()) throw new Error("Note title cannot be empty")
      if (patch.content !== undefined && !patch.content.trim()) throw new Error("Note content cannot be empty")
      const next: NoteRecord = {
        ...current,
        ...patch,
        kind: patch.kind === undefined ? current.kind : assertKind(patch.kind),
        status: patch.status === undefined ? current.status : assertNoteStatus(patch.status),
        revision: current.revision + 1,
        updatedAt: now,
        updatedBy: actor,
        updatedSession: session,
      }
      const update = this.database.prepare(`
        UPDATE notes SET
          topic = ?, kind = ?, title = ?, content = ?, sources = ?, status = ?,
          superseded_by = ?, revision = ?, updated_at = ?, updated_by = ?, updated_session = ?
        WHERE id = ? AND revision = ?
      `).run(
        next.topic, next.kind, next.title, next.content, json(next.sources), next.status,
        next.supersededBy, next.revision, next.updatedAt, next.updatedBy, next.updatedSession,
        id, current.revision,
      )
      if (Number(update.changes) !== 1) {
        throw new Error(`Note ${id} changed: expected revision ${current.revision}`)
      }
      this.archive("note", id, current.revision, current, actor, now)
      return { id, revision: next.revision, created: false }
    })
  }

  overview(limitPerTopic = 3): {
    projectRules: NoteRecord | null
    total: number
    topics: Array<{ topic: string; count: number; titles: string[] }>
  } {
    const projectRules = this.getNoteOrNull("project-rules")
    const totalRow = asRecord(this.database.prepare("SELECT count(*) AS total FROM notes WHERE status = 'active'").get())
    const total = number(totalRow.total, "note total")
    const topicRows = this.database.prepare(
      "SELECT topic, count(*) AS count FROM notes WHERE status = 'active' GROUP BY topic ORDER BY topic",
    ).all()
    const topics = topicRows.map((value) => {
      const row = asRecord(value)
      const topic = text(row.topic, "note topic")
      const rows = this.database.prepare(
        "SELECT title FROM notes WHERE status = 'active' AND topic = ? ORDER BY updated_at DESC LIMIT ?",
      ).all(topic, Math.min(Math.max(Math.trunc(limitPerTopic), 1), 10))
      return {
        topic,
        count: number(row.count, "topic count"),
        titles: rows.map((item) => text(asRecord(item).title, "note title")),
      }
    })
    return { projectRules, total, topics }
  }

  private getNoteOrNull(id: string): NoteRecord | null {
    const row = this.database.prepare("SELECT * FROM notes WHERE id = ? AND status = 'active'").get(id)
    return row === undefined || row === null ? null : mapNote(row)
  }

  history(entity: "task" | "note", id: string, limit = 5, offset = 0): HistoryRecord[] {
    assertId(id, `${entity} id`)
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20)
    return this.database.prepare(
      "SELECT * FROM history WHERE entity = ? AND entity_id = ? ORDER BY revision DESC LIMIT ? OFFSET ?",
    ).all(entity, id, safeLimit, offset).map(mapHistory)
  }

  historyRevision(entity: "task" | "note", id: string, revision: number): HistoryRecord | null {
    assertId(id, `${entity} id`)
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("revision must be a positive integer")
    const row = this.database.prepare(
      "SELECT * FROM history WHERE entity = ? AND entity_id = ? AND revision = ?",
    ).get(entity, id, revision)
    return row == null ? null : mapHistory(row)
  }
}
