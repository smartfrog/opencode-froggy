import { response, textResponse } from "../memory/bounds"
import { openProjectMemory, type ProjectMemory } from "../memory/project"
import { TASK_STATUSES, type TaskStatus } from "../memory/store"
import { inputRecord, recordId, requireMemoryWriter, textPatch, versionInput } from "../memory/tool-input"
import { allTasks, formatBoard, formatTaskDetails } from "../memory/views"

const BOARD_STATUSES = TASK_STATUSES.filter((status) => status !== "done")
const TASK_ACTIONS = ["list", "get", "save"]

function renderList(store: ProjectMemory["store"], status: unknown): { content: string } {
  const filter = typeof status === "string" ? status as TaskStatus : undefined
  if (filter && !TASK_STATUSES.includes(filter)) throw new Error(`Invalid task status: ${status}`)
  const columns: readonly TaskStatus[] = filter ? [filter] : BOARD_STATUSES
  return textResponse(formatBoard(columns.flatMap((column) => allTasks(store, column)), [...columns]))
}

function renderGet(store: ProjectMemory["store"], id: string): { content: string } {
  const task = store.getTask(id)
  if (!task) throw new Error(`Task not found: ${id}`)
  return textResponse(formatTaskDetails(task))
}

export function createTaskBoardTool(directory: string) {
  return {
    name: "task-board",
    options: { codemode: false },
    description: "Simple project tasks rendered as Markdown: a status board without done by default, or one task's current description. All agents read with list/get; only memory-manager may save. Updates replace supplied fields and require the current expectedVersion. Writes return JSON receipts.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: TASK_ACTIONS },
        id: { type: "string", description: "Stable task ID" },
        title: { type: "string", maxLength: 200 },
        status: { type: "string", enum: TASK_STATUSES },
        description: { type: "string", description: "Current task synthesis in Markdown: scope, acceptance, state, next action and useful evidence links; not a journal" },
        expectedVersion: { type: "integer", minimum: 1, description: "Current task version from get or a write receipt; required for updates" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = inputRecord(input, ["action", "id", "title", "status", "description", "expectedVersion"])
      if (typeof args.action !== "string" || !TASK_ACTIONS.includes(args.action)) throw new Error(`action must be ${TASK_ACTIONS.join(", ")}`)
      const read = args.action === "list" || args.action === "get"
      if (!read) requireMemoryWriter(context)
      const expectedVersion = versionInput(args.expectedVersion)
      if (read && expectedVersion !== null) throw new Error("expectedVersion is only valid for writes")
      const { path, store } = openProjectMemory(directory, { readonly: read })
      try {
        const metadata = { path, ...(store.migrationBackup ? { migrationBackup: store.migrationBackup } : {}) }
        if (args.action === "list") return renderList(store, args.status)
        const id = recordId(args.id)
        if (args.action === "get") return renderGet(store, id)
        return response({ ...metadata, ...store.saveTask(id, textPatch(args, ["title", "status", "description"]), expectedVersion) })
      } finally {
        store.close()
      }
    },
  }
}
