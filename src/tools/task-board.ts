import { response, textResponse } from "../memory/bounds"
import { openProjectMemory, type ProjectMemory } from "../memory/project"
import { TASK_STATUSES, type TaskStatus } from "../memory/store"
import { inputRecord, recordId, requireMemoryWriter, textPatch, versionInput } from "../memory/tool-input"
import { allTasks, formatBoard, formatTaskDetails } from "../memory/views"

const BOARD_STATUSES = TASK_STATUSES.filter((status) => status !== "done")

function renderList(store: ProjectMemory["store"], status: unknown): { content: string } {
  const filter = typeof status === "string" ? status as TaskStatus : undefined
  if (filter && !TASK_STATUSES.includes(filter)) throw new Error(`Invalid task status: ${status}`)
  const columns: readonly TaskStatus[] = filter ? [filter] : BOARD_STATUSES
  return textResponse(formatBoard(columns.flatMap((column) => allTasks(store, column)), [...columns]))
}

function renderGet(store: ProjectMemory["store"], id: string): { content: string } {
  const { task, notes } = store.getTaskWithNotes(id)
  return textResponse(formatTaskDetails(task, notes))
}

export function createTaskBoardTool(directory: string) {
  return {
    name: "task-board",
    options: { codemode: false },
    description: "Simple project tasks rendered as Markdown: a status board without done by default, or one task with its notes. All agents read with list/get; only memory-manager may save or add a note, and those return JSON receipts with expectedVersion checks.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "save", "note"] },
        id: { type: "string", description: "Stable task ID" },
        title: { type: "string", maxLength: 200 },
        status: { type: "string", enum: TASK_STATUSES },
        description: { type: "string", description: "Detailed task description in Markdown, including useful evidence links" },
        note: { type: "string", maxLength: 500, description: "Short, meaningful progress update; not a log" },
        expectedVersion: { type: "integer", minimum: 1, description: "Version from a previous write receipt; required for updates" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = inputRecord(input, ["action", "id", "title", "status", "description", "note", "expectedVersion"])
      if (!["list", "get", "save", "note"].includes(String(args.action))) throw new Error("action must be list, get, save or note")
      if (args.action === "save" || args.action === "note") requireMemoryWriter(context)
      const expectedVersion = versionInput(args.expectedVersion)
      const read = args.action === "list" || args.action === "get"
      if (read && expectedVersion !== null) throw new Error("expectedVersion is only valid for writes")
      const { path, store } = openProjectMemory(directory, { readonly: read })
      try {
        const metadata = { path, ...(store.migrationBackup ? { migrationBackup: store.migrationBackup } : {}) }
        if (args.action === "list") return renderList(store, args.status)
        const id = recordId(args.id)
        if (args.action === "get") return renderGet(store, id)
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
