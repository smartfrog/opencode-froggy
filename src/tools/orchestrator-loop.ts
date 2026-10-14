import { asRecord } from "../record"
import {
  DEFAULT_LOOP_INTERVAL_MINUTES,
  MAX_LOOP_INTERVAL_MINUTES,
  type createOrchestratorLoop,
} from "../orchestrator-loop"

function currentSessionID(context: unknown): string {
  const sessionID = asRecord(context).sessionID
  if (typeof sessionID !== "string") throw new Error("A current session is required")
  return sessionID
}

export function createOrchestratorLoopTools(loop: ReturnType<typeof createOrchestratorLoop>) {
  const startTool = {
    name: "start-orchestrator-loop",
    description:
      "Start or update persistent coordination reminders for the current root orchestrator session. " +
      "Defaults to every 10 minutes. Short coordination checks steer even during active work. " +
      "Use stop-orchestrator-loop when the objective is achieved or the user asks to stop reminders.",
    input: {
      type: "object",
      properties: {
        objective: { type: "string", minLength: 1, description: "The user-approved objective to coordinate toward" },
        intervalMinutes: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LOOP_INTERVAL_MINUTES,
          default: DEFAULT_LOOP_INTERVAL_MINUTES,
          description: "Minutes between reminders",
        },
      },
      required: ["objective"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      const sessionID = currentSessionID(context)
      const result = await loop.start(sessionID, input)
      return {
        content: `Coordination reminders enabled for ${sessionID} every ${result.intervalMinutes} minutes. ` +
          "The first reminder arrives after this interval. Settings survive plugin reloads. " +
          "Call stop-orchestrator-loop to disable them.",
      }
    },
  }

  const stopTool = {
    name: "stop-orchestrator-loop",
    description: "Disable periodic coordination reminders for the current session and cancel any still pending reminder.",
    input: { type: "object", properties: {}, additionalProperties: false },
    async execute(_input: unknown, context: unknown) {
      const sessionID = currentSessionID(context)
      await loop.stop(sessionID)
      return { content: `Coordination reminders disabled for ${sessionID}. Pending reminders cancelled.` }
    },
  }

  return { startTool, stopTool }
}
