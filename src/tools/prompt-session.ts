import { log } from "../logger"
import { type ChildSessionTracker } from "../session-children"
import { asRecord, renderSubagentCompletion, resolveChildTurn, type ChildTurnResult } from "../child-completion"

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

interface PendingTurn {
  since: number
  anchorID?: string
  deadline?: number
}

interface CompletionWatch {
  pending: Set<PendingTurn>
  completed: Set<string>
  running: boolean
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    if (signal?.aborted) finish()
    else signal?.addEventListener("abort", finish, { once: true })
  })
}

export function createPromptSessionTool(
  session: SessionClient,
  tracker: ChildSessionTracker,
  options?: { pollIntervalMs?: number; maxWatchMs?: number; signal?: AbortSignal },
) {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxWatchMs = options?.maxWatchMs ?? DEFAULT_MAX_WATCH_MS
  const signal = options?.signal
  const watches = new Map<string, CompletionWatch>()

  function getWatch(key: string): CompletionWatch {
    let watch = watches.get(key)
    if (!watch) {
      watch = { pending: new Set(), completed: new Set(), running: false }
      watches.set(key, watch)
    }
    return watch
  }

  function stopWatch(key: string, watch: CompletionWatch): void {
    watch.running = false
    if (watches.get(key) === watch) watches.delete(key)
  }

  async function notifyWatchAbandoned(parentSessionID: string, childSessionID: string, reason: string): Promise<void> {
    if (signal?.aborted) return
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

  async function notifyCompletion(
    parentSessionID: string,
    childSessionID: string,
    title: string | undefined,
    result: ChildTurnResult,
  ): Promise<void> {
    if (signal?.aborted) return
    log("[prompt-session] notifying parent of child completion", {
      parentSessionID,
      childSessionID,
      completionID: result.completionID,
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
  }

  async function notifyWhenChildCompletes(
    key: string,
    childSessionID: string,
    parentSessionID: string,
    watch: CompletionWatch,
  ): Promise<void> {
    log("[prompt-session] watching child completions", { parentSessionID, childSessionID })
    let failures = 0
    try {
      while (watch.pending.size > 0 && !signal?.aborted) {
        await sleep(pollIntervalMs, signal)
        if (signal?.aborted) return

        const expired = [...watch.pending].filter((turn) => turn.deadline !== undefined && turn.deadline <= Date.now())
        for (const turn of expired) watch.pending.delete(turn)
        if (expired.length > 0) {
          log("[prompt-session] completion watch timed out", { parentSessionID, childSessionID, maxWatchMs })
          await notifyWatchAbandoned(parentSessionID, childSessionID, `the child turn did not complete within ${maxWatchMs} ms`)
        }
        const ready = [...watch.pending].filter((turn) => turn.deadline !== undefined)
        if (ready.length === 0 || signal?.aborted) continue

        let messages: unknown
        let title: string | undefined
        try {
          const info = asRecord(await session.get({ sessionID: childSessionID }))
          if (signal?.aborted) return
          title = typeof info.title === "string" ? info.title : undefined
          const idle = asRecord(info.time).idle
          if (typeof idle !== "number" || !ready.some((turn) => idle >= turn.since)) {
            failures = 0
            continue
          }
          messages = await session.context({ sessionID: childSessionID })
        } catch (error) {
          if (signal?.aborted) return
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
            stopWatch(key, watch)
            await notifyWatchAbandoned(parentSessionID, childSessionID, `polling failed ${failures} times in a row`)
            return
          }
          continue
        }
        if (signal?.aborted) return
        failures = 0
        for (const turn of ready) {
          const result = resolveChildTurn(messages, turn.since, turn.anchorID)
          if (!result) continue
          if (!watch.completed.has(result.completionID)) {
            await notifyCompletion(parentSessionID, childSessionID, title, result)
            if (signal?.aborted) return
            watch.completed.add(result.completionID)
          }
          watch.pending.delete(turn)
        }
      }
    } catch (error) {
      if (signal?.aborted) return
      stopWatch(key, watch)
      log("[prompt-session] completion notification failed", {
        parentSessionID,
        childSessionID,
        error: String(error),
      })
      await notifyWatchAbandoned(parentSessionID, childSessionID, `completion notification failed: ${String(error)}`)
    } finally {
      stopWatch(key, watch)
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
      signal?.throwIfAborted()
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

      const key = JSON.stringify([ctx.sessionID, targetSessionId])
      let watch = getWatch(key)
      const turn: PendingTurn = { since: Date.now() }
      watch.pending.add(turn)
      try {
        const inbox = asRecord(await session.prompt({ sessionID: targetSessionId, text: args.message, delivery: "queue" }))
        signal?.throwIfAborted()
        turn.anchorID = typeof inbox.id === "string" ? inbox.id : undefined
        turn.deadline = Date.now() + maxWatchMs
        const previousCompletions = watch.completed
        watch = getWatch(key)
        for (const completionID of previousCompletions) watch.completed.add(completionID)
        watch.pending.add(turn)
        if (!watch.running) {
          watch.running = true
          void notifyWhenChildCompletes(key, targetSessionId, ctx.sessionID, watch)
        }
      } catch (error) {
        watch.pending.delete(turn)
        if (!watch.running && watch.pending.size === 0) stopWatch(key, watch)
        throw error
      }
      return {
        content:
          `Message sent to child session ${targetSessionId}. ` +
          "You will be notified when it completes. Do not sleep or poll for its progress.",
      }
    },
  }
}
