import { asRecord } from "../record"
import { formatSessionContextMarkdown } from "../session-context"
import { createSessionContextClient, type SessionContextClient } from "../session-context-api"
import { collectSessionContext } from "../session-context-report"

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

interface SessionContextToolOptions {
  client?: SessionContextClient
  verifySession?: (sessionID: string) => Promise<void>
}

export function createSessionContextTool(
  projectID: string,
  directory: string,
  options: SessionContextToolOptions = {},
) {
  const client = options.client ?? createSessionContextClient()
  const verifySession = options.verifySession
  return {
    name: "session-context",
    description: "List recent project sessions as a Markdown table with active context size, model/agent, cumulative tokens, cost and character breakdown by category and by tool. Returns only aggregated results, never raw session messages.",
    input: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `Number of recent sessions to analyze; defaults to ${DEFAULT_LIMIT}`,
        },
      },
      additionalProperties: false,
    },
    async execute(input: unknown, context?: unknown) {
      if (typeof projectID !== "string" || !projectID) throw new Error("A project is required")
      if (typeof directory !== "string" || !directory) throw new Error("A directory is required")
      const sessionID = asRecord(context).sessionID
      if (verifySession && typeof sessionID === "string" && sessionID) await verifySession(sessionID)
      const args = asRecord(input)
      const limit = args.limit === undefined ? DEFAULT_LIMIT : args.limit
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`)
      }

      const report = await collectSessionContext(client, projectID, limit, directory)
      if (report.rows.length === 0) return { content: "No sessions found for the current project." }
      return { content: formatSessionContextMarkdown(report.rows, { limitError: report.limitError }) }
    },
  }
}
