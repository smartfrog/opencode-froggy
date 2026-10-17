import { capText, response, textRange } from "../memory/bounds"
import { openProjectMemory } from "../memory/project"
import { TASK_STATUSES } from "../memory/store"
import { inputRecord, pageNumber, recordId, requireMemoryWriter, textPatch, versionInput } from "../memory/tool-input"

const TASKS_PER_PAGE = 10
const NOTES_PER_PAGE = 3
const DESCRIPTION_CHARACTERS = 1_000

export function createTaskBoardTool(directory: string) {
  return {
    name: "task-board",
    options: { codemode: false },
    description: "Simple project tasks: title, status, detailed description and short progress notes. All agents read with list/get; only memory-manager may save or add a note. Pass nextPage to continue, and expectedVersion to update safely.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "save", "note"] },
        id: { type: "string", description: "Stable task ID" },
        title: { type: "string", maxLength: 200 },
        status: { type: "string", enum: TASK_STATUSES },
        description: { type: "string", description: "Detailed task description in Markdown, including useful evidence links" },
        note: { type: "string", maxLength: 500, description: "Short, meaningful progress update; not a log" },
        expectedVersion: { type: "integer", minimum: 1, description: "Version read by get; required for updates, optional to pin a paged read" },
        page: { type: "integer", minimum: 0, description: "Use nextPage from the previous response" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = inputRecord(input, ["action", "id", "title", "status", "description", "note", "expectedVersion", "page"])
      if (!["list", "get", "save", "note"].includes(String(args.action))) throw new Error("action must be list, get, save or note")
      if (args.action === "save" || args.action === "note") requireMemoryWriter(context)
      const page = pageNumber(args.page)
      const expectedVersion = versionInput(args.expectedVersion)
      const { path, store } = openProjectMemory(directory)
      try {
        const metadata = { path, ...(store.migrationBackup ? { migrationBackup: store.migrationBackup } : {}) }
        if (args.action === "list") {
          const status = typeof args.status === "string" ? args.status : undefined
          const rows = store.listTasks(status, TASKS_PER_PAGE + 1, page * TASKS_PER_PAGE)
          const tasks = rows.slice(0, TASKS_PER_PAGE).map(({ id, title, status, version }) => ({
            id, title: capText(title, 200).text, status, version,
          }))
          return response({ ...metadata, tasks, nextPage: rows.length > TASKS_PER_PAGE ? page + 1 : null })
        }
        const id = recordId(args.id)
        if (args.action === "get") {
          const { task, notes } = store.getTaskWithNotes(id, NOTES_PER_PAGE + 1, page * NOTES_PER_PAGE)
          if (expectedVersion !== null && task.version !== expectedVersion) throw new Error(`Task ${id} changed: expected version ${expectedVersion}, current ${task.version}`)
          const length = Array.from(task.description).length
          const description = textRange(task.description, Math.min(page * DESCRIPTION_CHARACTERS, length), DESCRIPTION_CHARACTERS)
          return response({
            ...metadata, task: { ...task, description: description.text }, notes: notes.slice(0, NOTES_PER_PAGE),
            nextPage: description.hasMore || notes.length > NOTES_PER_PAGE ? page + 1 : null,
          })
        }
        if (args.action === "note") {
          if (typeof args.note !== "string") throw new Error("note is required")
          return response({ ...metadata, ...store.addTaskNote(id, args.note, expectedVersion) })
        }
        return response({ ...metadata, ...store.saveTask(id, textPatch(args, ["title", "status", "description"]), expectedVersion) })
      } finally {
        store.close()
      }
    },
  }
}
