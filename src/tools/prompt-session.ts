import { log } from "../logger"
import type { ChildSessionTracker } from "../session-children"
import { asRecord, renderSubagentCompletion, resolveChildTurn } from "../child-completion"
import type { ChildTurnResult } from "../child-completion"

const DEFAULT_POLL_INTERVAL_MS = 3000
const DEFAULT_MAX_WATCH_MS = 30 * 60 * 1000
const MAX_CONSECUTIVE_FAILURES = 3

export interface PromptSessionArgs {
  message: string
  sessionId?: string
}

interface SessionClient {
  prompt(input: { sessionID: string; text: string; delivery?: "steer" | "queue" }): Promise<unknown>
  get(input: { sessionID: string }): Promise<unknown>
  context(input: { sessionID: string }): Promise<unknown>
  synthetic(input: {
    sessionID: string
    text: string
    description?: string
    delivery?: "steer" | "queue"
    metadata?: Record<string, string>
  }): Promise<unknown>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createPromptSessionTool(
  session: SessionClient,
  tracker: ChildSessionTracker,
  options?: { pollIntervalMs?: number; maxWatchMs?: number },
) {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxWatchMs = options?.maxWatchMs ?? DEFAULT_MAX_WATCH_MS

  async function notifyWatchAbandoned(parentSessionID: string, childSessionID: string, reason: string): Promise<void> {
    try {
      await session.synthetic({
        sessionID: parentSessionID,
        text: renderSubagentCompletion({
          sessionID: childSessionID,
          state: "error",
          description: "Completion watch abandoned",
          text: `The promised completion notification for this child session will not arrive: ${reason}`,
        }),
        description: "Completion watch abandoned",
        delivery: "queue",
        metadata: { source: "subagent", childID: childSessionID, state: "error" },
      })
    } catch (error) {
      log("[prompt-session] failed to notify watch abandonment", {
        parentSessionID,
        childSessionID,
        error: String(error),
      })
    }
  }

  async function notifyWhenChildCompletes(
    childSessionID: string,
    parentSessionID: string,
    since: number,
    anchorID?: string,
  ): Promise<void> {
    log("[prompt-session] waiting for child turn completion", { parentSessionID, childSessionID, anchorID })
    const deadline = Date.now() + maxWatchMs
    let failures = 0
    try {
      while (Date.now() < deadline) {
        await sleep(pollIntervalMs)
        let result: ChildTurnResult | null = null
        let title: string | undefined
        try {
          const info = asRecord(await session.get({ sessionID: childSessionID }))
          title = typeof info.title === "string" ? info.title : undefined
          const idle = asRecord(info.time).idle
          if (typeof idle === "number" && idle > since) {
            const messages = await session.context({ sessionID: childSessionID })
            result = resolveChildTurn(messages, since, anchorID)
          }
        } catch (error) {
          failures += 1
          log("[prompt-session] poll failed", {
            parentSessionID,
            childSessionID,
            failure: failures,
            error: String(error),
          })
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            log("[prompt-session] completion watch stopped after repeated failures", {
              parentSessionID,
              childSessionID,
            })
            await notifyWatchAbandoned(parentSessionID, childSessionID, `polling failed ${failures} times in a row`)
            return
          }
          continue
        }
        failures = 0
        if (!result) continue

        if (!result.text) {
          log("[prompt-session] child turn ended without captured report", { childSessionID })
        }
        log("[prompt-session] notifying parent of child completion", {
          parentSessionID,
          childSessionID,
          state: result.state,
          reportPreview: result.text.slice(0, 100),
        })
        await session.synthetic({
          sessionID: parentSessionID,
          text: renderSubagentCompletion({
            sessionID: childSessionID,
            state: result.state,
            description: title,
            text: result.text,
          }),
          description: title ?? "Subagent turn completed",
          delivery: "queue",
          metadata: { source: "subagent", childID: childSessionID, state: result.state },
        })
        return
      }
      log("[prompt-session] completion watch timed out", { parentSessionID, childSessionID, maxWatchMs })
      await notifyWatchAbandoned(parentSessionID, childSessionID, `the child turn did not complete within ${maxWatchMs} ms`)
    } catch (error) {
      log("[prompt-session] completion notification failed", {
        parentSessionID,
        childSessionID,
        error: String(error),
      })
    }
  }

  return {
    name: "prompt-session",
    description:
      "Send a message to a child session (subagent) to continue the conversation. " +
      "Returns immediately; when the child finishes its turn, this session receives " +
      "a task completion notification with the child's final report.",
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

      const since = Date.now()
      const inbox = asRecord(await session.prompt({ sessionID: targetSessionId, text: args.message, delivery: "queue" }))
      const anchorID = typeof inbox.id === "string" ? inbox.id : undefined
      void notifyWhenChildCompletes(targetSessionId, ctx.sessionID, since, anchorID)
      return {
        content:
          `Message sent to child session ${targetSessionId}. ` +
          "You will be notified when it completes. Do not sleep or poll for its progress.",
      }
    },
  }
}
