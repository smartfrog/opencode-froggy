import { asRecord } from "../record"
import { openProjectMemory } from "../memory/project"
import { agentContext, stringArray } from "../memory/tool-input"
import {
  DETAIL_ARRAY_ITEMS,
  DETAIL_ARRAY_ITEM_CHARACTERS,
  DETAIL_FIELD_CHARACTERS,
  RANGE_LIMIT,
  SUMMARY_TEXT_CHARACTERS,
  SUMMARY_TITLE_CHARACTERS,
  capArray,
  capText,
  fieldResponse,
  pageLimit,
  pageOffset,
  pageResponse,
  response,
} from "../memory/bounds"
import { historyResponse } from "../memory/history-response"
import { type TaskPatch, type TaskRecord } from "../memory/store"

const TASK_WRITERS = new Set(["orchestrator", "build"])
const TASK_FIELDS = [
  "title", "objective", "acceptance", "currentState", "nextAction", "blockers",
  "knowledgeRefs", "evidence", "assignments",
] as const
type TaskField = typeof TASK_FIELDS[number]

function requireWriter(value: unknown): { agent: string; session: string } {
  const current = agentContext(value)
  if (!TASK_WRITERS.has(current.agent)) throw new Error("Only the coordinator may change tasks")
  if (!current.session) throw new Error("A current session is required to change tasks")
  return current
}

function taskSummary(task: TaskRecord) {
  const title = capText(task.title, SUMMARY_TITLE_CHARACTERS)
  const nextAction = capText(task.nextAction, SUMMARY_TEXT_CHARACTERS)
  return {
    id: task.id,
    title: title.text,
    status: task.status,
    nextAction: nextAction.text,
    revision: task.revision,
    truncated: [
      ...(title.truncated ? ["title"] : []),
      ...(nextAction.truncated ? ["nextAction"] : []),
    ],
  }
}

function taskDetail(task: TaskRecord) {
  const truncated: string[] = []
  const field = (name: string, value: string): string => {
    const result = capText(value, DETAIL_FIELD_CHARACTERS)
    if (result.truncated) truncated.push(name)
    return result.text
  }
  const references = (name: string, value: string[]): string[] => {
    const capped = capArray(value, DETAIL_ARRAY_ITEMS)
    if (capped.omitted > 0) truncated.push(name)
    return capped.items.map((item) => {
      const result = capText(item, DETAIL_ARRAY_ITEM_CHARACTERS)
      if (result.truncated) truncated.push(name)
      return result.text
    })
  }
  return {
    ...task,
    title: field("title", task.title),
    objective: field("objective", task.objective),
    acceptance: field("acceptance", task.acceptance),
    currentState: field("currentState", task.currentState),
    nextAction: field("nextAction", task.nextAction),
    blockers: field("blockers", task.blockers),
    knowledgeRefs: references("knowledgeRefs", task.knowledgeRefs),
    evidence: references("evidence", task.evidence),
    assignments: references("assignments", task.assignments),
    truncated: [...new Set(truncated)],
    hint: truncated.length ? "Use get with field, offset and limit to read the complete value" : null,
  }
}

function taskField(path: string, task: TaskRecord, field: unknown, offset: number, limit: number | undefined, item: number | undefined) {
  if (typeof field !== "string" || !TASK_FIELDS.includes(field as TaskField)) {
    throw new Error(`field must be one of ${TASK_FIELDS.join(", ")}`)
  }
  return fieldResponse({ path, id: task.id, field, revision: task.revision }, task[field as TaskField], offset, limit, item)
}

function patch(args: Record<string, unknown>): TaskPatch {
  const result: TaskPatch = {}
  for (const field of ["title", "status", "objective", "acceptance", "currentState", "nextAction", "blockers"] as const) {
    const value = args[field]
    if (value === undefined) continue
    if (typeof value !== "string") throw new Error(`Invalid ${field}`)
    result[field] = value
  }
  if (args.knowledgeRefs !== undefined) result.knowledgeRefs = stringArray(args.knowledgeRefs, "knowledgeRefs")
  if (args.evidence !== undefined) result.evidence = stringArray(args.evidence, "evidence")
  if (args.assignments !== undefined) result.assignments = stringArray(args.assignments, "assignments")
  return result
}

export function createTaskBoardTool(directory: string) {
  return {
    name: "task-board",
    options: { codemode: false },
    description: "Coordinator-owned project task state. List or read bounded task summaries, save partial task updates with revision checks, and read long fields through revision-aware ranges.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "save", "history"] },
        id: { type: "string", description: "Stable task id" },
        revision: { type: "integer", minimum: 1, description: "Select an archived revision with history; read its JSON snapshot by offset/limit" },
        field: { type: "string", enum: TASK_FIELDS, description: "Read one field range instead of the bounded task" },
        item: { type: "integer", minimum: 0, description: "Array item index for a field range" },
        status: { type: "string", description: "Filter for list, or new status for save" },
        offset: { type: "integer", minimum: 0, description: "Character or array-item offset for get, or row offset for list/history" },
        limit: { type: "integer", minimum: 1, maximum: RANGE_LIMIT, description: "Range or page limit" },
        expectedRevision: { type: ["integer", "null"], minimum: 1, description: "Required to update a task, or to pin a ranged read" },
        title: { type: "string" },
        objective: { type: "string" },
        acceptance: { type: "string" },
        currentState: { type: "string" },
        nextAction: { type: "string" },
        blockers: { type: "string" },
        knowledgeRefs: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
        assignments: { type: "array", items: { type: "string" }, description: "Compact agent/session/workspace/revision references" },
        full: { type: "boolean", description: "Include bounded historical previews; use revision to read an entire archived snapshot" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input: unknown, toolContext: unknown) {
      const args = asRecord(input)
      if (typeof args.action !== "string") throw new Error("A task-board action is required")
      const { path, store } = openProjectMemory(directory)
      try {
        if (args.action === "list") {
          const status = typeof args.status === "string" && args.status.trim() ? args.status : undefined
          const limit = pageLimit(typeof args.limit === "number" ? args.limit : undefined, 20, 20)
          const offset = pageOffset(typeof args.offset === "number" ? args.offset : 0)
          const rows = store.listTasks(status, limit + 1, offset)
          return pageResponse(rows.slice(0, limit).map(taskSummary), offset, rows.length > limit, (page, nextOffset) => ({
            path,
            tasks: page,
            hasMore: nextOffset !== null,
            nextOffset,
          }))
        }
        if (args.action === "get") {
          if (typeof args.id !== "string" || !args.id) throw new Error("A task id is required")
          const task = store.getTask(args.id)
          if (!task) throw new Error(`Task not found: ${args.id}`)
          if (typeof args.expectedRevision === "number" && task.revision !== args.expectedRevision) {
            throw new Error(`Task ${args.id} changed: expected revision ${args.expectedRevision}, current ${task.revision}`)
          }
          if (args.field !== undefined) {
            const offset = typeof args.offset === "number" ? args.offset : 0
            const limit = typeof args.limit === "number" ? args.limit : undefined
            const item = typeof args.item === "number" ? args.item : undefined
            return taskField(path, task, args.field, offset, limit, item)
          }
          return response({ path, task: taskDetail(task) })
        }
        if (args.action === "history") {
          return historyResponse(store, path, "task", args)
        }
        if (args.action !== "save") throw new Error("action must be list, get, save or history")
        const current = requireWriter(toolContext)
        if (typeof args.id !== "string" || !args.id) throw new Error("A task id is required")
        const expectedRevision = typeof args.expectedRevision === "number" ? args.expectedRevision : null
        const result = store.saveTask(args.id, patch(args), current.agent, current.session, expectedRevision)
        return response({ path, ...result })
      } finally {
        store.close()
      }
    },
  }
}
