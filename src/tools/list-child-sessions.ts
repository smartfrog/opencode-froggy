import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../logger"

type Client = ReturnType<typeof createOpencodeClient>

export function createListChildSessionsTool(client: Client) {
  return tool({
    description: "List all child sessions (subagents) of the current session",
    args: {},
    async execute(_args: Record<string, never>, context: ToolContext) {
      const children = await client.session.children({
        path: { id: context.sessionID },
      })

      const childList = children.data ?? []
      if (childList.length === 0) {
        return "No child sessions found"
      }

      log("[list-child-sessions] Found child sessions", { count: childList.length })

      const formatted = childList.map((child, index) => {
        const created = new Date(child.time.created).toISOString()
        const updated = new Date(child.time.updated).toISOString()
        return `${index + 1}. [${child.id}] ${child.title}\n   Created: ${created} | Updated: ${updated}`
      }).join("\n\n")

      return `Child sessions (${childList.length}):\n\n${formatted}`
    },
  })
}
