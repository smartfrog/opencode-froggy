import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { asRecord } from "./record"
import { type LoopSessionClient } from "./orchestrator-loop"
import { type ChildSessionInfo } from "./session-children"

const execFileAsync = promisify(execFile)

export type OpenCodeRequest = (method: "get" | "delete", path: string) => Promise<unknown>

export const requestOpenCodeAPI: OpenCodeRequest = async (method, path) => {
  const args = ["api", method, path]
  try {
    const { stdout } = await execFileAsync("opencode", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
    return stdout.trim() ? JSON.parse(stdout) as unknown : undefined
  } catch (error) {
    throw new Error(`OpenCode API ${method} ${path} failed: ${String(error)}`, { cause: error })
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid OpenCode API object")
  return asRecord(value)
}

function data(value: unknown): unknown {
  const response = record(value)
  if (!("data" in response)) throw new Error("OpenCode API response is missing data")
  return response.data
}

function items(value: unknown): Record<string, unknown>[] {
  const list = data(value)
  if (!Array.isArray(list)) throw new Error("Invalid OpenCode API list")
  return list.map(record)
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid OpenCode API string")
  return value
}

function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new Error("Invalid OpenCode session timestamp")
  }
  return value
}

export function createOrchestratorClients(
  native: Pick<LoopSessionClient, "get" | "synthetic">,
  request: OpenCodeRequest = requestOpenCodeAPI,
) {
  const sessionPath = (id: string) => `/api/session/${encodeURIComponent(id)}`
  const inboxPath = (input: { sessionID: string; inboxID: string }) =>
    `${sessionPath(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`

  async function verifySession(sessionID: string): Promise<void> {
    const host = record(await native.get({ sessionID }))
    const remote = record(data(await request("get", sessionPath(sessionID))))
    const created = record(host.time).created
    if (typeof created !== "number" || remote.id !== sessionID || record(remote.time).created !== created) {
      throw new Error("The opencode CLI must connect to the same OpenCode service as this plugin")
    }
  }

  const session: LoopSessionClient = {
    get: (input) => native.get(input),
    synthetic: (input) => native.synthetic(input),
    inbox: {
      async list({ sessionID }) {
        await verifySession(sessionID)
        return items(await request("get", `${sessionPath(sessionID)}/inbox`)).map((item) => ({
          id: text(item.id), type: text(item.type), payload: record(item.payload),
        }))
      },
      async cancel(input) {
        await request("delete", inboxPath(input))
      },
    },
  }

  async function listChildren(parentID: string): Promise<ChildSessionInfo[]> {
    if (typeof parentID !== "string" || !parentID.startsWith("ses")) throw new Error("A parent session is required")
    await verifySession(parentID)
    const children = new Map<string, ChildSessionInfo>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const query = new URLSearchParams({ parentID, limit: "100" })
      if (cursor) query.set("cursor", cursor)
      const page = record(await request("get", `/api/session?${query}`))
      for (const item of items(page)) {
        if (item.parentID !== parentID) throw new Error("OpenCode child inventory returned a different parent")
        const time = record(item.time)
        const id = text(item.id)
        if (!id.startsWith("ses")) throw new Error("Invalid OpenCode child session ID")
        children.set(id, {
          id, parentID,
          title: item.title === undefined ? undefined : text(item.title),
          created: timestamp(time.created),
          updated: timestamp(time.updated),
        })
      }
      const next = record(page.cursor).next
      if (next !== undefined && next !== null && (typeof next !== "string" || !next)) throw new Error("Invalid OpenCode pagination cursor")
      cursor = typeof next === "string" ? next : undefined
      if (cursor) {
        if (cursors.has(cursor)) throw new Error("OpenCode child pagination did not advance")
        cursors.add(cursor)
      }
    } while (cursor)
    return [...children.values()].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
  }

  return { session, listChildren }
}
