import { response, textResponse } from "../memory/bounds"
import { CONTENT_READ_PROPERTIES, contentReadInput, type ContentRead } from "../memory/content-read"
import { openProjectMemory, type ProjectMemory } from "../memory/project"
import { inputRecord, recordId, requireMemoryWriter, restoreInput, textPatch, versionInput } from "../memory/tool-input"
import {
  formatKnowledgeList,
  formatKnowledgeNote,
  formatKnowledgeSearch,
  formatKnowledgeTopics,
  formatRevisions,
} from "../memory/views"

function renderTopics(store: ProjectMemory["store"]): { content: string } {
  const { topics, knowledgeCount } = store.knowledgeInventory()
  return textResponse(formatKnowledgeTopics(topics, knowledgeCount))
}

function renderList(store: ProjectMemory["store"], topic: unknown): { content: string } {
  return textResponse(formatKnowledgeList(store.listNotes({ topic: typeof topic === "string" ? topic : undefined })))
}

function renderSearch(store: ProjectMemory["store"], query: unknown, topic: unknown): { content: string } {
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required")
  return textResponse(formatKnowledgeSearch(store.listNotes({ query, topic: typeof topic === "string" ? topic : undefined })))
}

function renderGet(store: ProjectMemory["store"], id: string, read: ContentRead): { content: string } {
  const note = store.getNote(id)
  if (!note) throw new Error(`Knowledge not found: ${id}`)
  return textResponse(formatKnowledgeNote(note, read))
}

const ACTIONS = ["topics", "list", "search", "get", "history", "save", "remove", "restore"]

export function createKnowledgeTool(directory: string) {
  return {
    name: "knowledge",
    options: { codemode: false },
    description: "Project knowledge: topics/list, ranked full-text search, get (complete or version-checked slices), and history limited to current + one previous version. Removal retains only the last saved entry and its removal token. Only memory-manager saves, removes or restores with expectedVersion checks; writes return JSON receipts.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ACTIONS },
        id: { type: "string", description: "Stable knowledge ID" },
        topic: { type: "string", maxLength: 80 },
        title: { type: "string", maxLength: 200 },
        content: { type: "string", description: "Useful durable knowledge in Markdown; include source links when needed" },
        query: { type: "string", description: "Search topic, title and content" },
        expectedVersion: { type: "integer", minimum: 1, description: "Current version required for updates, removal and restoration; use the latest removal version for a deleted entry" },
        restoreVersion: { type: "integer", minimum: 1, description: "Retained version from history to restore as a new current version; older snapshots are discarded" },
        ...CONTENT_READ_PROPERTIES,
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = inputRecord(input, ["action", "id", "topic", "title", "content", "query", "expectedVersion", "restoreVersion", "offset", "limit", "version"])
      if (typeof args.action !== "string" || !ACTIONS.includes(args.action)) throw new Error(`action must be ${ACTIONS.join(", ")}`)
      const read = ["topics", "list", "search", "get", "history"].includes(String(args.action))
      if (!read) requireMemoryWriter(context)
      const expectedVersion = versionInput(args.expectedVersion)
      if (read && expectedVersion !== null) throw new Error("expectedVersion is only valid for writes")
      const contentRead = contentReadInput(args)
      const restore = restoreInput(args)
      const { path, store } = openProjectMemory(directory, { readonly: read })
      try {
        const metadata = { path, ...(store.migrationBackup ? { migrationBackup: store.migrationBackup } : {}) }
        if (args.action === "topics") return renderTopics(store)
        if (args.action === "list") return renderList(store, args.topic)
        if (args.action === "search") return renderSearch(store, args.query, args.topic)
        const id = recordId(args.id)
        if (args.action === "get") return renderGet(store, id, contentRead)
        if (args.action === "history") {
          if (contentRead.version !== undefined) return textResponse(formatKnowledgeNote(store.getNoteRevision(id, contentRead.version), contentRead))
          if (contentRead.offset !== undefined || contentRead.limit !== undefined) throw new Error("version is required to slice a historical entry")
          return textResponse(formatRevisions(id, store.listRevisions("knowledge", id)))
        }
        if (restore) {
          return response({ ...metadata, ...store.restoreNote(id, restore.version, restore.expectedVersion) })
        }
        if (args.action === "remove") {
          if (expectedVersion === null) throw new Error("expectedVersion is required for removal")
          return response({ ...metadata, ...store.removeNote(id, expectedVersion) })
        }
        return response({ ...metadata, ...store.saveNote(id, textPatch(args, ["topic", "title", "content"]), expectedVersion) })
      } finally {
        store.close()
      }
    },
  }
}
