import { asRecord } from "../record"
import { openProjectMemory } from "../memory/project"
import { agentContext, stringArray } from "../memory/tool-input"
import {
  DETAIL_ARRAY_ITEMS,
  DETAIL_ARRAY_ITEM_CHARACTERS,
  NOTE_CONTENT_CHARACTERS,
  OVERVIEW_TOPICS,
  RANGE_LIMIT,
  SEARCH_LIMIT,
  SUMMARY_TITLE_CHARACTERS,
  TOPIC_CHARACTERS,
  TOPIC_TITLE_CHARACTERS,
  capArray,
  capText,
  fieldResponse,
  pageLimit,
  pageOffset,
  pageResponse,
  response,
  textRange,
} from "../memory/bounds"
import { historyResponse } from "../memory/history-response"
import { type NotePatch, type NoteRecord } from "../memory/store"

const KNOWLEDGE_WRITERS = new Set(["memory-manager"])
const NOTE_FIELDS = ["content", "title", "topic", "sources"] as const
type NoteField = typeof NOTE_FIELDS[number]

function requireWriter(value: unknown): { agent: string; session: string } {
  const current = agentContext(value)
  if (!KNOWLEDGE_WRITERS.has(current.agent)) throw new Error("Only memory-manager may change knowledge")
  if (!current.session) throw new Error("A current session is required to change knowledge")
  return current
}

function noteSummary(note: NoteRecord) {
  const topic = capText(note.topic, TOPIC_CHARACTERS)
  const title = capText(note.title, SUMMARY_TITLE_CHARACTERS)
  const excerpt = capText(note.content.replace(/\s+/g, " ").trim(), 240)
  return {
    id: note.id,
    topic: topic.text,
    kind: note.kind,
    title: title.text,
    excerpt: excerpt.text,
    revision: note.revision,
    truncated: [
      ...(topic.truncated ? ["topic"] : []),
      ...(title.truncated ? ["title"] : []),
      ...(excerpt.truncated ? ["excerpt"] : []),
    ],
  }
}

function noteField(path: string, note: NoteRecord, field: unknown, offset: number, limit: number | undefined, item: number | undefined) {
  if (typeof field !== "string" || !NOTE_FIELDS.includes(field as NoteField)) {
    throw new Error(`field must be one of ${NOTE_FIELDS.join(", ")}`)
  }
  return fieldResponse(
    { path, id: note.id, field, revision: note.revision }, note[field as NoteField],
    offset, limit, item, field === "content" ? NOTE_CONTENT_CHARACTERS : RANGE_LIMIT,
  )
}

function noteDetail(note: NoteRecord, offset: number, limit: number) {
  const content = textRange(note.content, offset, limit)
  const topic = capText(note.topic, TOPIC_CHARACTERS)
  const title = capText(note.title, SUMMARY_TITLE_CHARACTERS)
  const sources = capArray(note.sources, DETAIL_ARRAY_ITEMS)
  const sourceItems = sources.items.map((item) => capText(item, DETAIL_ARRAY_ITEM_CHARACTERS))
  const truncated = [
    ...(topic.truncated ? ["topic"] : []),
    ...(title.truncated ? ["title"] : []),
    ...(sources.omitted > 0 || sourceItems.some((item) => item.truncated) ? ["sources"] : []),
    ...(content.hasMore ? ["content"] : []),
  ]
  return {
    ...note,
    topic: topic.text,
    title: title.text,
    content: content.text,
    sources: sourceItems.map((item) => item.text),
    offset: content.offset,
    nextOffset: content.nextOffset,
    hasMore: content.hasMore,
    totalCharacters: content.totalCharacters,
    truncated,
    hint: truncated.length
      ? "Use get with field, offset and limit to read the complete value"
      : null,
  }
}

function patch(args: Record<string, unknown>): NotePatch {
  const result: NotePatch = {}
  for (const field of ["topic", "kind", "title", "content", "status"] as const) {
    const value = args[field]
    if (value === undefined) continue
    if (typeof value !== "string") throw new Error(`Invalid ${field}`)
    result[field] = value
  }
  if (args.sources !== undefined) result.sources = stringArray(args.sources, "sources")
  if (args.supersededBy !== undefined) {
    if (args.supersededBy !== null && typeof args.supersededBy !== "string") throw new Error("Invalid supersededBy")
    result.supersededBy = args.supersededBy
  }
  return result
}

export function createKnowledgeTool(directory: string) {
  return {
    name: "knowledge",
    options: { codemode: false },
    description: "Project knowledge for memory-manager and bounded readers. Overview lists topics, search returns short hits, get reads one note or a revision-checked range, save applies a revision-checked correction, and history exposes archived revisions.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["overview", "search", "get", "save", "history"] },
        id: { type: "string", description: "Stable note id" },
        revision: { type: "integer", minimum: 1, description: "Select an archived revision with history; read its JSON snapshot by offset/limit" },
        field: { type: "string", enum: NOTE_FIELDS, description: "Read one field range instead of the bounded note" },
        item: { type: "integer", minimum: 0, description: "Array item index for a field range" },
        query: { type: "string", description: "Text to search in topic, title and content" },
        topic: { type: "string", description: "Optional topic filter or new topic" },
        kind: { type: "string", enum: ["constraint", "decision", "fact", "lesson"] },
        status: { type: "string", enum: ["active", "superseded"] },
        offset: { type: "integer", minimum: 0, description: "Character, array-item, topic or history offset" },
        limit: { type: "integer", minimum: 1, maximum: RANGE_LIMIT },
        expectedRevision: { type: ["integer", "null"], minimum: 1, description: "Required to update a note, or to pin a ranged read" },
        title: { type: "string" },
        content: { type: "string" },
        sources: { type: "array", items: { type: "string" } },
        supersededBy: { type: ["string", "null"] },
        full: { type: "boolean", description: "Include bounded historical previews; use revision to read an entire archived snapshot" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, toolContext: unknown) {
      const args = asRecord(input)
      if (typeof args.action !== "string") throw new Error("A knowledge action is required")
      const { path, store } = openProjectMemory(directory)
      try {
        if (args.action === "overview") {
          const overview = store.overview()
          const offset = pageOffset(typeof args.offset === "number" ? args.offset : 0)
          const limit = pageLimit(typeof args.limit === "number" ? args.limit : undefined, OVERVIEW_TOPICS, OVERVIEW_TOPICS)
          const topics = overview.topics.slice(offset, offset + limit).map((topic) => {
            const name = capText(topic.topic, TOPIC_CHARACTERS)
            const titles = topic.titles.map((title) => capText(title, TOPIC_TITLE_CHARACTERS))
            return {
              topic: name.text,
              count: topic.count,
              titles: titles.map((title) => title.text),
              truncated: name.truncated || titles.some((title) => title.truncated),
            }
          })
          const rules = overview.projectRules
          return pageResponse(topics, offset, offset + topics.length < overview.topics.length, (page, nextOffset) => ({
            path,
            total: overview.total,
            totalTopics: overview.topics.length,
            nextOffset,
            hasMore: nextOffset !== null,
            projectRules: rules ? {
              id: rules.id,
              title: capText(rules.title, SUMMARY_TITLE_CHARACTERS).text,
              content: capText(rules.content, 2_000).text,
              revision: rules.revision,
              truncated: capText(rules.content, 2_000).truncated,
            } : null,
            topics: page,
          }))
        }
        if (args.action === "search") {
          if (typeof args.query !== "string" || !args.query.trim()) throw new Error("A search query is required")
          const limit = pageLimit(typeof args.limit === "number" ? args.limit : undefined, 5, SEARCH_LIMIT)
          const offset = pageOffset(typeof args.offset === "number" ? args.offset : 0)
          const results = store.searchNotes(args.query, {
            topic: typeof args.topic === "string" ? args.topic : undefined,
            kind: typeof args.kind === "string" ? args.kind : undefined,
            limit: limit + 1,
            offset,
          })
          return pageResponse(results.slice(0, limit).map(noteSummary), offset, results.length > limit, (page, nextOffset) => ({
            path,
            results: page,
            hasMore: nextOffset !== null,
            nextOffset,
          }))
        }
        if (args.action === "get") {
          if (typeof args.id !== "string" || !args.id) throw new Error("A note id is required")
          const note = store.getNote(args.id)
          if (!note) throw new Error(`Note not found: ${args.id}`)
          if (typeof args.expectedRevision === "number" && note.revision !== args.expectedRevision) {
            throw new Error(`Note ${args.id} changed: expected revision ${args.expectedRevision}, current ${note.revision}`)
          }
          const offset = typeof args.offset === "number" ? args.offset : 0
          if (args.field !== undefined) {
            const limit = typeof args.limit === "number" ? args.limit : undefined
            const item = typeof args.item === "number" ? args.item : undefined
            return noteField(path, note, args.field, offset, limit, item)
          }
          const limit = typeof args.limit === "number" ? Math.min(args.limit, NOTE_CONTENT_CHARACTERS) : NOTE_CONTENT_CHARACTERS
          return response({ path, note: noteDetail(note, offset, limit) })
        }
        if (args.action === "history") {
          return historyResponse(store, path, "note", args)
        }
        if (args.action !== "save") throw new Error("action must be overview, search, get, save or history")
        const current = requireWriter(toolContext)
        if (typeof args.id !== "string" || !args.id) throw new Error("A note id is required")
        const expectedRevision = typeof args.expectedRevision === "number" ? args.expectedRevision : null
        const result = store.saveNote(args.id, patch(args), current.agent, current.session, expectedRevision)
        return response({ path, ...result })
      } finally {
        store.close()
      }
    },
  }
}
