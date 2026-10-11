import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { asRecord } from "./child-completion"
import { type ActivitySessionClient } from "./orchestrator-activity"
import { type LoopSessionClient } from "./orchestrator-loop"

const execFileAsync = promisify(execFile)

export type OpenCodeRequest = (method: "get" | "patch" | "delete", path: string, body?: Record<string, string>) => Promise<unknown>

export const requestOpenCodeAPI: OpenCodeRequest = async (method, path, body) => {
  const args = ["api", method, path]
  if (body) args.push("--data", JSON.stringify(body))
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

  const session: LoopSessionClient & ActivitySessionClient = {
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
      async update(input) {
        await request("patch", inboxPath(input), { delivery: input.delivery })
      },
    },
    async list(input) {
      const query = new URLSearchParams({ parentID: input.parentID, limit: input.limit })
      if (input.cursor) query.set("cursor", input.cursor)
      const response = record(await request("get", `/api/session?${query}`))
      const next = response.cursor == null ? undefined : record(response.cursor).next
      return {
        data: items(response).map((child) => ({
          id: text(child.id),
          agent: typeof child.agent === "string" ? child.agent : undefined,
          title: typeof child.title === "string" ? child.title : undefined,
          location: { directory: text(record(child.location).directory) },
        })),
        ...(next == null ? {} : { cursor: { next: text(next) } }),
      }
    },
    async active() {
      const active = record(data(await request("get", "/api/session/active")))
      return Object.fromEntries(Object.entries(active).map(([id, value]) => [id, { type: text(record(value).type) }]))
    },
  }

  const shell = {
    async list({ location }: { location: { directory: string } }) {
      const query = new URLSearchParams({ "location[directory]": location.directory })
      return {
        data: items(await request("get", `/api/shell?${query}`)).map((item) => ({
          id: text(item.id), status: text(item.status), metadata: record(item.metadata),
        })),
      }
    },
  }

  return { session, shell }
}
