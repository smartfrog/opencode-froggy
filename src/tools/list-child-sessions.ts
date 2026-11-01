import { log } from "../logger"
import { asRecord } from "../record"
import { type ChildSessionInfo } from "../orchestrator-api"

export function createListChildSessionsTool(
  listPersistedChildren: (parentID: string) => Promise<ChildSessionInfo[]>,
) {
  return {
    name: "list-child-sessions",
    description: "List persisted direct child sessions of the current session across reloads. Reports verified inventory or fails explicitly if discovery is unavailable; inventory is not worker activity or task completion.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(_input: unknown, context: unknown) {
      const sessionID = asRecord(context).sessionID
      if (typeof sessionID !== "string" || !sessionID.startsWith("ses")) throw new Error("A current session is required")
      const inventory = "Inventory verified from persisted sessions (all pages)."
      let childList: ChildSessionInfo[]
      try {
        childList = await listPersistedChildren(sessionID)
      } catch (error) {
        throw new Error(`Child session inventory unavailable: ${String(error)}`, { cause: error })
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
