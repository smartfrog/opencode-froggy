import { capText, response, textRange } from "../memory/bounds"
import { openProjectMemory } from "../memory/project"
import { inputRecord, pageNumber, recordId, requireMemoryWriter, textPatch, versionInput } from "../memory/tool-input"

const RESULTS_PER_PAGE = 5
const CONTENT_CHARACTERS = 2_000

export function createKnowledgeTool(directory: string) {
  return {
    name: "knowledge",
    options: { codemode: false },
    description: "Valuable project knowledge grouped by topic: constraints, performance tips, pitfalls and decisions. All agents use list/search/get. Only memory-manager decides what to save, merge or permanently remove. Use nextPage to continue; updates and removals require expectedVersion.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "search", "get", "save", "remove"] },
        id: { type: "string", description: "Stable knowledge ID" },
        topic: { type: "string", maxLength: 80 },
        title: { type: "string", maxLength: 200 },
        content: { type: "string", description: "Useful durable knowledge in Markdown; include source links when needed" },
        query: { type: "string", description: "Search topic, title and content" },
        expectedVersion: { type: "integer", minimum: 1, description: "Version read by get; required for updates and permanent removal, optional to pin a paged read" },
        page: { type: "integer", minimum: 0, description: "Use nextPage from the previous response" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = inputRecord(input, ["action", "id", "topic", "title", "content", "query", "expectedVersion", "page"])
      if (!["list", "search", "get", "save", "remove"].includes(String(args.action))) throw new Error("action must be list, search, get, save or remove")
      if (args.action === "save" || args.action === "remove") requireMemoryWriter(context)
      const page = pageNumber(args.page)
      const expectedVersion = versionInput(args.expectedVersion)
      const { path, store } = openProjectMemory(directory)
      try {
        const metadata = { path, ...(store.migrationBackup ? { migrationBackup: store.migrationBackup } : {}) }
        if (args.action === "list" || args.action === "search") {
          if (args.action === "search" && (typeof args.query !== "string" || !args.query.trim())) throw new Error("query is required")
          const rows = store.listNotes({
            query: args.action === "search" ? args.query as string : undefined,
            topic: typeof args.topic === "string" ? args.topic : undefined,
            limit: RESULTS_PER_PAGE + 1, offset: page * RESULTS_PER_PAGE,
          })
          const results = rows.slice(0, RESULTS_PER_PAGE).map(({ id, topic, title, content, version }) => ({
            id, topic: capText(topic, 80).text, title: capText(title, 200).text, version,
            ...(args.action === "search" ? { excerpt: capText(content.replace(/\s+/g, " "), 200).text } : {}),
          }))
          return response({ ...metadata, results, nextPage: rows.length > RESULTS_PER_PAGE ? page + 1 : null })
        }
        const id = recordId(args.id)
        if (args.action === "get") {
          const note = store.getNote(id)
          if (!note) throw new Error(`Knowledge not found: ${id}`)
          if (expectedVersion !== null && note.version !== expectedVersion) throw new Error(`Knowledge ${id} changed: expected version ${expectedVersion}, current ${note.version}`)
          const content = textRange(note.content, Math.min(page * CONTENT_CHARACTERS, Array.from(note.content).length), CONTENT_CHARACTERS)
          return response({ ...metadata, note: { ...note, content: content.text }, nextPage: content.hasMore ? page + 1 : null })
        }
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
