export interface ContentRead {
  offset?: number
  limit?: number
  version?: number
}

export const CONTENT_READ_PROPERTIES = {
  offset: { type: "integer", minimum: 0, description: "Character offset for a content slice; use the returned next offset" },
  limit: { type: "integer", minimum: 1, maximum: 16_000, description: "Characters per slice; defaults to 8000 when slicing" },
  version: { type: "integer", minimum: 1, description: "Required version for continuation reads; selects a saved version with history" },
} as const

export function contentReadInput(args: Record<string, unknown>): ContentRead {
  const result: ContentRead = {}
  for (const key of ["offset", "limit", "version"] as const) {
    if (args[key] === undefined) continue
    const value = args[key]
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (key === "offset" ? 0 : 1)) {
      throw new Error(`${key} must be ${key === "offset" ? "a non-negative" : "a positive"} integer`)
    }
    if (key === "limit" && value > 16_000) throw new Error("limit must not exceed 16000 characters")
    result[key] = value
  }
  if (Object.keys(result).length && args.action !== "get" && args.action !== "history") {
    throw new Error("offset, limit and version are only valid for get/history")
  }
  if ((result.offset ?? 0) > 0 && result.version === undefined) throw new Error("version is required for continuation reads")
  return result
}

export function formatRecordContent(content: string, version: number, read: ContentRead = {}): string {
  if (read.version !== undefined && read.version !== version) throw new Error(`Record changed: expected version ${read.version}, current ${version}`)
  if (read.offset === undefined && read.limit === undefined) return content
  const characters = Array.from(content)
  const offset = read.offset ?? 0
  if (offset > characters.length) throw new Error("offset exceeds content length")
  const end = Math.min(offset + (read.limit ?? 8_000), characters.length)
  return [
    `Characters: ${offset}–${end} of ${characters.length}`,
    `Next offset: ${end < characters.length ? end : "none"}`,
    "", "--- content ---", characters.slice(offset, end).join(""),
  ].join("\n")
}
