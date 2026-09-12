import { log } from "../logger"
import type { ChildSessionTracker } from "../session-children"

export interface PromptSessionArgs {
  message: string
  sessionId?: string
}

interface SessionPrompter {
  prompt(input: { sessionID: string; text: string }): Promise<unknown>
}

export function createPromptSessionTool(
  session: SessionPrompter,
  tracker: ChildSessionTracker
) {
  return {
    name: "prompt-session",
    description: "Send a message to a child session (subagent) to continue the conversation",
    input: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to send to the child session" },
        sessionId: {
          type: "string",
          description: "The child session ID to target (optional - uses last child if not provided)",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const args = input as PromptSessionArgs
      const ctx = context as { sessionID: string }
      const targetSessionId = args.sessionId ?? tracker.lastChild(ctx.sessionID)?.id
      if (!targetSessionId) {
        return { content: "Error: No child session found for current session" }
      }

      log("[prompt-session] Sending message to child session", {
        parentSessionID: ctx.sessionID,
        childSessionID: targetSessionId,
        messagePreview: args.message.slice(0, 100),
      })

      await session.prompt({ sessionID: targetSessionId, text: args.message })
      return { content: `Message sent to child session ${targetSessionId}` }
    },
  }
}
