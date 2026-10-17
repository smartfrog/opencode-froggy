import { log } from "../logger"
import { asRecord } from "../record"
import type { ChildSessionInfo, ChildSessionTracker } from "../session-children"

export function createListChildSessionsTool(
  tracker: ChildSessionTracker,
  listPersistedChildren: (parentID: string) => Promise<ChildSessionInfo[]>,
) {
  return {
    name: "list-child-sessions",
    description: "List persisted direct child sessions of the current session across reloads. Reports verified inventory or an explicitly incomplete cached fallback; inventory is not worker activity or task completion.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(_input: unknown, context: unknown) {
      const sessionID = asRecord(context).sessionID
      if (typeof sessionID !== "string" || !sessionID.startsWith("ses")) throw new Error("A current session is required")
      let inventory = "Inventory verified from persisted sessions (all pages)."
      let childList: ChildSessionInfo[]
      try {
        childList = await listPersistedChildren(sessionID)
        tracker.replaceChildren(sessionID, childList)
      } catch (error) {
        childList = tracker.listChildren(sessionID)
        if (!childList.length) throw new Error(`Child session inventory unavailable: ${String(error)}`, { cause: error })
        inventory = `Inventory incomplete: cached sessions only; metadata may be stale. Discovery failed: ${String(error)}`
      }
      if (childList.length === 0) {
        return { content: `${inventory}\nNo child sessions found` }
      }

      log("[list-child-sessions] Found child sessions", { count: childList.length })

      const formatted = childList
        .map((child, index) => {
          const created = new Date(child.created).toISOString()
          const updated = new Date(child.updated).toISOString()
          const title = child.title ? ` ${child.title}` : ""
          return `${index + 1}. [${child.id}]${title}\n   Created: ${created} | Updated: ${updated}`
        })
        .join("\n\n")

      return { content: `${inventory}\nChild sessions (${childList.length}):\n\n${formatted}` }
    },
  }
}
