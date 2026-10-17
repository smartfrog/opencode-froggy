import { HISTORY_LIMIT, capText, pageLimit, pageOffset, pageResponse, rangeResponse } from "./bounds"
import { type MemoryStore } from "./store"

export function historyResponse(
  store: MemoryStore,
  path: string,
  entity: "task" | "note",
  args: Record<string, unknown>,
): { content: string } {
  if (typeof args.id !== "string" || !args.id) throw new Error(`A ${entity} id is required`)
  const offset = pageOffset(typeof args.offset === "number" ? args.offset : 0)
  if (args.revision !== undefined) {
    if (typeof args.revision !== "number") throw new Error("revision must be a positive integer")
    const entry = store.historyRevision(entity, args.id, args.revision)
    if (!entry) throw new Error(`Archived ${entity} revision not found: ${args.id}@${args.revision}`)
    return rangeResponse(
      { path, id: args.id, revision: entry.revision, format: "json" },
      JSON.stringify(entry.snapshot), offset, typeof args.limit === "number" ? args.limit : undefined,
    )
  }
  const limit = pageLimit(typeof args.limit === "number" ? args.limit : undefined, HISTORY_LIMIT, HISTORY_LIMIT)
  const entries = store.history(entity, args.id, limit + 1, offset)
  const previews = entries.slice(0, limit).map((entry) => {
    const { snapshot, ...metadata } = entry
    if (args.full !== true) return metadata
    const serialized = JSON.stringify(snapshot)
    return serialized.length <= 2_000
      ? entry
      : { ...metadata, snapshot: capText(serialized, 2_000).text, snapshotTruncated: true }
  })
  return pageResponse(previews, offset, entries.length > limit, (history, nextOffset) => ({
    path, history, hasMore: nextOffset !== null, nextOffset,
  }))
}
