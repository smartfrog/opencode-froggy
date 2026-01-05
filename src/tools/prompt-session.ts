import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../logger"

type Client = ReturnType<typeof createOpencodeClient>

export interface PromptSessionArgs {
  message: string
  sessionId?: string
}

export function createPromptSessionTool(client: Client) {
  return tool({
    description: "Send a message to a child session (subagent) to continue the conversation",
    args: {
      message: tool.schema.string().describe("The message to send to the child session"),
      sessionId: tool.schema.string().optional().describe("The child session ID to target (optional - uses last child if not provided)"),
    },
    async execute(args: PromptSessionArgs, context: ToolContext) {
      let targetSessionId = args.sessionId

      if (!targetSessionId) {
        const children = await client.session.children({
          path: { id: context.sessionID },
        })

        const lastChild = (children.data ?? []).at(-1)
        if (!lastChild) {
          return "Error: No child session found for current session"
        }

        targetSessionId = lastChild.id
      }

      log("[prompt-session] Sending message to child session", {
        parentSessionID: context.sessionID,
        childSessionID: targetSessionId,
        messagePreview: args.message.slice(0, 100),
      })

      const response = await client.session.prompt({
        path: { id: targetSessionId },
        body: { parts: [{ type: "text", text: args.message }] },
      })

      const parts = (response.data as { parts?: Array<{ type: string; text?: string }> })?.parts ?? []
      const textContent = parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")

      return textContent || "Message sent to child session"
    },
  })
}
