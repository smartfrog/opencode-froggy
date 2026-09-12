import { log } from "../logger"
import type { ChildSessionTracker } from "../session-children"

export function createListChildSessionsTool(tracker: ChildSessionTracker) {
  return {
    name: "list-child-sessions",
    description: "List all child sessions (subagents) of the current session",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(_input: unknown, context: unknown) {
      const ctx = context as { sessionID: string }
      const childList = tracker.listChildren(ctx.sessionID)
      if (childList.length === 0) {
        return { content: "No child sessions found" }
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

      return { content: `Child sessions (${childList.length}):\n\n${formatted}` }
    },
  }
}
