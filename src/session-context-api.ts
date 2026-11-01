import { asRecord } from "./record"
import { modelLabel, parseTokens, type SessionSummary } from "./session-context"
import { readAPIItems, requestOpenCodeAPI, type OpenCodeRequest } from "./orchestrator-api"

export interface SessionContextClient {
  listSessions(projectID: string, limit: number): Promise<SessionSummary[]>
  getContext(sessionID: string): Promise<unknown[]>
  listModelLimits(directory: string): Promise<Map<string, number>>
}

export interface SessionContextClientOptions {
  request?: OpenCodeRequest
  readContext: (sessionID: string) => Promise<unknown[]>
  listModels: (directory: string) => Promise<readonly unknown[]>
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${field}`)
  return value
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function parseSession(value: Record<string, unknown>, projectID: string): SessionSummary {
  const id = requiredText(value.id, "session id")
  if (!id.startsWith("ses")) throw new Error("Invalid session id")
  const sessionProject = optionalText(value.projectID)
  if (sessionProject !== null && sessionProject !== projectID) throw new Error("Session belongs to a different project")
  const parent = value.parentID
  if (parent !== null && parent !== undefined && (typeof parent !== "string" || !parent.startsWith("ses"))) {
    throw new Error("Invalid parent session id")
  }
  const model = modelLabel(value.model)
  const cost = value.cost
  if (cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost))) throw new Error("Invalid session cost")
  return {
    id,
    parentID: typeof parent === "string" ? parent : null,
    title: optionalText(value.title),
    agent: optionalText(value.agent),
    model: model.label,
    modelKey: model.key,
    cost: typeof cost === "number" ? cost : 0,
    tokens: parseTokens(value.tokens),
  }
}

export function createSessionContextClient(options: SessionContextClientOptions): SessionContextClient {
  const request = options.request ?? requestOpenCodeAPI
  const { readContext, listModels } = options

  async function listSessions(projectID: string, limit: number): Promise<SessionSummary[]> {
    if (!projectID) throw new Error("A project is required")
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("A positive session limit is required")
    const query = new URLSearchParams({ limit: String(limit), order: "desc", project: projectID })
    const sessions = readAPIItems(await request("get", `/api/session?${query}`))
    return sessions.map((session) => parseSession(session, projectID))
  }

  async function getContext(sessionID: string): Promise<unknown[]> {
    const id = requiredText(sessionID, "session id")
    const context = await readContext(id)
    if (!Array.isArray(context)) throw new Error("Invalid session context")
    return context
  }

  async function listModelLimits(directory: string): Promise<Map<string, number>> {
    if (!directory) throw new Error("A directory is required")
    const models = await listModels(directory)
    const publicLimits = new Map<string, number>()
    const aliases = new Map<string, number>()
    for (const model of models.map(asRecord)) {
      const provider = optionalText(model.providerID)
      const id = optionalText(model.id)
      const modelID = optionalText(model.modelID)
      const context = asRecord(model.limit).context
      if (!provider || typeof context !== "number" || !Number.isFinite(context) || context <= 0) continue
      if (id) publicLimits.set(`${provider}/${id}`, context)
      if (modelID && modelID !== id) aliases.set(`${provider}/${modelID}`, context)
    }
    return new Map([...aliases, ...publicLimits])
  }

  return { listSessions, getContext, listModelLimits }
}
