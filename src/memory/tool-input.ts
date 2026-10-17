import { asRecord } from "../record"

export function agentContext(value: unknown): { agent: string; session: string } {
  const record = asRecord(value)
  return {
    agent: typeof record.agent === "string" ? record.agent : "",
    session: typeof record.sessionID === "string" ? record.sessionID : "",
  }
}

export function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`Invalid ${field}`)
  return value
}
