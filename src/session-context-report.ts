import { analyzeContext, type SessionContextRow } from "./session-context"
import { type SessionContextClient } from "./session-context-api"

export interface SessionContextReport {
  rows: SessionContextRow[]
  limitError: string | null
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

export async function collectSessionContext(
  client: SessionContextClient,
  projectID: string,
  limit: number,
  directory: string,
): Promise<SessionContextReport> {
  const sessions = await client.listSessions(projectID, limit)
  if (sessions.length === 0) return { rows: [], limitError: null }

  let limits = new Map<string, number>()
  let limitError: string | null = null
  try {
    limits = await client.listModelLimits(directory)
  } catch (error) {
    limitError = errorMessage(error)
  }

  const rows: SessionContextRow[] = await Promise.all(sessions.map(async (session) => {
    try {
      const messages = await client.getContext(session.id)
      const contextLimit = session.modelKey ? limits.get(session.modelKey) ?? null : null
      return { session, analysis: analyzeContext(messages, contextLimit), error: null }
    } catch (error) {
      return { session, analysis: null, error: errorMessage(error) }
    }
  }))

  return { rows, limitError }
}
