import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { asRecord } from "./record"
import { modelLabel, parseTokens, type SessionSummary } from "./session-context"
import { requestOpenCodeAPI, type OpenCodeRequest } from "./orchestrator-api"

export interface SessionContextClient {
  listSessions(projectID: string, limit: number): Promise<SessionSummary[]>
  getContext(sessionID: string): Promise<unknown[]>
  getSession(sessionID: string): Promise<{ id: string; created: number }>
  listModelLimits(directory: string): Promise<Map<string, number>>
}

export interface SessionContextClientOptions {
  request?: OpenCodeRequest
  fetchContext?: (url: string, headers?: Record<string, string>) => Promise<unknown>
  resolveEndpoint?: () => Promise<{ url: string; password?: string }>
  readContext?: (sessionID: string) => Promise<unknown[]>
  listModels?: (directory: string) => Promise<readonly unknown[]>
}

interface ServiceEndpoint {
  url: string
  password?: string
}

type FetchJSON = (url: string, headers?: Record<string, string>) => Promise<unknown>
type EndpointResolver = () => Promise<ServiceEndpoint>

const fetchJSON: FetchJSON = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`OpenCode API request failed: ${response.status}`)
  return response.json()
}

async function serviceEndpoint(): Promise<ServiceEndpoint> {
  const state = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state")
  const file = join(state, "opencode", "service.json")
  const info = asRecord(JSON.parse(await readFile(file, "utf8")))
  return {
    url: requiredText(info.url, "service url"),
    password: typeof info.password === "string" ? info.password : undefined,
  }
}

function data(value: unknown): unknown {
  const response = asRecord(value)
  if (!("data" in response)) throw new Error("OpenCode API response is missing data")
  return response.data
}

function items(value: unknown): Record<string, unknown>[] {
  const list = data(value)
  if (!Array.isArray(list)) throw new Error("Invalid OpenCode API list")
  return list.map(asRecord)
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

export async function resolveProjectID(directory: string, request: OpenCodeRequest = requestOpenCodeAPI): Promise<string> {
  if (!directory) throw new Error("A directory is required")
  const query = new URLSearchParams({ "location[directory]": directory })
  const response = asRecord(await request("get", `/api/location?${query}`))
  return requiredText(asRecord(response.project).id, "project id")
}

export function createSessionContextClient(options: SessionContextClientOptions = {}): SessionContextClient {
  const request = options.request ?? requestOpenCodeAPI
  const fetchContext = options.fetchContext ?? fetchJSON
  const resolveEndpoint = options.resolveEndpoint ?? serviceEndpoint
  const readContext = options.readContext
  const listModels = options.listModels

  async function listSessions(projectID: string, limit: number): Promise<SessionSummary[]> {
    if (!projectID) throw new Error("A project is required")
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("A positive session limit is required")
    const query = new URLSearchParams({ limit: String(limit), order: "desc", project: projectID })
    const sessions = items(await request("get", `/api/session?${query}`))
    return sessions.map((session) => parseSession(session, projectID))
  }

  async function getContext(sessionID: string): Promise<unknown[]> {
    const id = requiredText(sessionID, "session id")
    if (readContext) {
      const context = await readContext(id)
      if (!Array.isArray(context)) throw new Error("Invalid session context")
      return context
    }
    const endpoint = await resolveEndpoint()
    const headers = endpoint.password === undefined
      ? undefined
      : { authorization: "Basic " + Buffer.from(`opencode:${endpoint.password}`).toString("base64") }
    const context = data(await fetchContext(`${endpoint.url}/api/session/${encodeURIComponent(id)}/context`, headers))
    if (!Array.isArray(context)) throw new Error("Invalid session context")
    return context
  }

  async function getSession(sessionID: string): Promise<{ id: string; created: number }> {
    const id = requiredText(sessionID, "session id")
    const session = asRecord(data(await request("get", `/api/session/${encodeURIComponent(id)}`)))
    const created = asRecord(session.time).created
    if (session.id !== id || typeof created !== "number" || !Number.isFinite(created)) {
      throw new Error("Invalid session response")
    }
    return { id, created }
  }

  async function listModelLimits(directory: string): Promise<Map<string, number>> {
    if (!directory) throw new Error("A directory is required")
    const models = listModels
      ? await listModels(directory)
      : items(await request("get", `/api/model?${new URLSearchParams({ "location[directory]": directory })}`))
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

  return { listSessions, getContext, getSession, listModelLimits }
}
