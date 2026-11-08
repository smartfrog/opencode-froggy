import { response, textResponse } from "../memory/bounds"
import { CONTENT_READ_PROPERTIES, contentReadInput, type ContentRead } from "../memory/content-read"
import { openProjectMemory, type ProjectMemory } from "../memory/project"
import { TASK_STATUSES, type TaskStatus } from "../memory/store"
import { inputRecord, recordId, requireMemoryWriter, restoreInput, textPatch, versionInput } from "../memory/tool-input"
import { formatBoard, formatRevisions, formatTaskDetails } from "../memory/views"

const BOARD_STATUSES = TASK_STATUSES.filter((status) => status !== "done")
const TASK_ACTIONS = ["list", "get", "history", "save", "restore"]

function renderList(store: ProjectMemory["store"], status: unknown): { content: string } {
  const filter = typeof status === "string" ? status as TaskStatus : undefined
  if (filter && !TASK_STATUSES.includes(filter)) throw new Error(`Invalid task status: ${status}`)
  const columns = filter ? [filter] : BOARD_STATUSES
  return textResponse(formatBoard(store.listTasks(columns), columns))
}

function renderGet(store: ProjectMemory["store"], id: string, read: ContentRead): { content: string } {
  const task = store.getTask(id)
  if (!task) throw new Error(`Task not found: ${id}`)
  return textResponse(formatTaskDetails(task, read))
}

export function createTaskBoardTool(directory: string) {
  return {
    name: "task-board",
    options: { codemode: false },
    description: "Project tasks: list (without done by default), get (complete or version-checked slices), and history limited to current + one previous version. Only memory-manager saves or restores. Updates and restores require the current expectedVersion; writes return JSON receipts.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: TASK_ACTIONS },
        id: { type: "string", description: "Stable task ID" },
        title: { type: "string", maxLength: 200 },
        status: { type: "string", enum: TASK_STATUSES },
        description: { type: "string", description: "Current task synthesis in Markdown: scope, acceptance, state, next action and useful evidence links; not a journal" },
        expectedVersion: { type: "integer", minimum: 1, description: "Current task version from get or a write receipt; required for updates" },
        restoreVersion: { type: "integer", minimum: 1, description: "Retained version from history to restore as a new current version; older snapshots are discarded" },
        ...CONTENT_READ_PROPERTIES,
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = inputRecord(input, ["action", "id", "title", "status", "description", "expectedVersion", "restoreVersion", "offset", "limit", "version"])
      if (typeof args.action !== "string" || !TASK_ACTIONS.includes(args.action)) throw new Error(`action must be ${TASK_ACTIONS.join(", ")}`)
      const read = args.action === "list" || args.action === "get" || args.action === "history"
      if (!read) requireMemoryWriter(context)
      const expectedVersion = versionInput(args.expectedVersion)
      if (read && expectedVersion !== null) throw new Error("expectedVersion is only valid for writes")
      const contentRead = contentReadInput(args)
      const restore = restoreInput(args)
      const { path, store } = openProjectMemory(directory, { readonly: read })
      try {
        const metadata = { path, ...(store.migrationBackup ? { migrationBackup: store.migrationBackup } : {}) }
        if (args.action === "list") return renderList(store, args.status)
        const id = recordId(args.id)
        if (args.action === "get") return renderGet(store, id, contentRead)
        if (args.action === "history") {
          if (contentRead.version !== undefined) return textResponse(formatTaskDetails(store.getTaskRevision(id, contentRead.version), contentRead))
          if (contentRead.offset !== undefined || contentRead.limit !== undefined) throw new Error("version is required to slice a historical entry")
          return textResponse(formatRevisions(id, store.listRevisions("task", id)))
        }
        if (restore) {
          return response({ ...metadata, ...store.restoreTask(id, restore.version, restore.expectedVersion) })
        }
        return response({ ...metadata, ...store.saveTask(id, textPatch(args, ["title", "status", "description"]), expectedVersion) })
      } finally {
        store.close()
      }
    },
  }
}
