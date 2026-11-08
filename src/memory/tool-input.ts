import { asRecord } from "../record"

export function agentContext(value: unknown): { agent: string; session: string } {
  const record = asRecord(value)
  return {
    agent: typeof record.agent === "string" ? record.agent : "",
    session: typeof record.sessionID === "string" ? record.sessionID : "",
  }
}

export function requireMemoryWriter(value: unknown): void {
  const current = agentContext(value)
  if (current.agent !== "memory-manager") throw new Error("Only memory-manager may change project memory")
  if (!current.session) throw new Error("A current session is required to change project memory")
}

export function inputRecord(value: unknown, fields: string[]): Record<string, unknown> {
  const args = asRecord(value)
  for (const field of Object.keys(args)) {
    if (!fields.includes(field)) throw new Error(`Unsupported memory parameter: ${field}`)
  }
  return args
}

export function recordId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("id is required")
  return value
}

export function versionInput(value: unknown, field = "expectedVersion"): number | null {
  if (value === undefined) return null
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`)
  return value
}

export function restoreInput(args: Record<string, unknown>): { version: number; expectedVersion: number } | null {
  if (args.action !== "restore") {
    if (args.restoreVersion !== undefined) throw new Error("restoreVersion is only valid for restore")
    return null
  }
  const expectedVersion = versionInput(args.expectedVersion)
  if (expectedVersion === null) throw new Error("expectedVersion is required for restore")
  const version = versionInput(args.restoreVersion, "restoreVersion")
  if (version === null) throw new Error("restoreVersion is required")
  return { version, expectedVersion }
}

export function pageNumber(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > Math.floor(Number.MAX_SAFE_INTEGER / 2_000)) {
    throw new Error("page must be a non-negative safe integer")
  }
  return value
}

export function textPatch(args: Record<string, unknown>, fields: string[]): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const field of fields) {
    if (args[field] === undefined) continue
    if (typeof args[field] !== "string") throw new Error(`Invalid ${field}`)
    patch[field] = args[field]
  }
  return patch
}
