import { response, textResponse } from "../memory/bounds"
import { openProjectMemory, type ProjectMemory } from "../memory/project"
import { inputRecord, recordId, requireMemoryWriter, textPatch, versionInput } from "../memory/tool-input"
import {
  allNotes,
  formatKnowledgeList,
  formatKnowledgeNote,
  formatKnowledgeSearch,
  formatKnowledgeTopics,
  readInventory,
} from "../memory/views"

function renderTopics(store: ProjectMemory["store"]): { content: string } {
  const { topics, knowledgeCount } = readInventory(store)
  return textResponse(formatKnowledgeTopics(topics, knowledgeCount))
}

function renderList(store: ProjectMemory["store"], topic: unknown): { content: string } {
  return textResponse(formatKnowledgeList(allNotes(store, { topic: typeof topic === "string" ? topic : undefined })))
}

function renderSearch(store: ProjectMemory["store"], query: unknown, topic: unknown): { content: string } {
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required")
  return textResponse(formatKnowledgeSearch(allNotes(store, { query, topic: typeof topic === "string" ? topic : undefined })))
}

function renderGet(store: ProjectMemory["store"], id: string): { content: string } {
  const note = store.getNote(id)
  if (!note) throw new Error(`Knowledge not found: ${id}`)
  return textResponse(formatKnowledgeNote(note))
}

export function createKnowledgeTool(directory: string) {
  return {
    name: "knowledge",
    options: { codemode: false },
    description: "Valuable project knowledge rendered as Markdown: topics, a list, a search or one full entry. All agents use topics/list/search/get; only memory-manager decides what to save, merge or permanently remove, and those return JSON receipts with expectedVersion checks.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["topics", "list", "search", "get", "save", "remove"] },
        id: { type: "string", description: "Stable knowledge ID" },
        topic: { type: "string", maxLength: 80 },
        title: { type: "string", maxLength: 200 },
        content: { type: "string", description: "Useful durable knowledge in Markdown; include source links when needed" },
        query: { type: "string", description: "Search topic, title and content" },
        expectedVersion: { type: "integer", minimum: 1, description: "Version from a previous write receipt; required for updates and permanent removal" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = inputRecord(input, ["action", "id", "topic", "title", "content", "query", "expectedVersion"])
      if (!["topics", "list", "search", "get", "save", "remove"].includes(String(args.action))) throw new Error("action must be topics, list, search, get, save or remove")
      if (args.action === "save" || args.action === "remove") requireMemoryWriter(context)
      const expectedVersion = versionInput(args.expectedVersion)
      const read = ["topics", "list", "search", "get"].includes(String(args.action))
      if (read && expectedVersion !== null) throw new Error("expectedVersion is only valid for writes")
      const { path, store } = openProjectMemory(directory, { readonly: read })
      try {
        const metadata = { path, ...(store.migrationBackup ? { migrationBackup: store.migrationBackup } : {}) }
        if (args.action === "topics") return renderTopics(store)
        if (args.action === "list") return renderList(store, args.topic)
        if (args.action === "search") return renderSearch(store, args.query, args.topic)
        const id = recordId(args.id)
        if (args.action === "get") return renderGet(store, id)
        if (args.action === "remove") {
          if (expectedVersion === null) throw new Error("expectedVersion is required for permanent removal")
          return response({ ...metadata, ...store.removeNote(id, expectedVersion) })
        }
        return response({ ...metadata, ...store.saveNote(id, textPatch(args, ["topic", "title", "content"]), expectedVersion) })
      } finally {
        store.close()
      }
    },
  }
}
