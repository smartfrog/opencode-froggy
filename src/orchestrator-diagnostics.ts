import { asRecord } from "./record"

type ReminderEvent = { at: number; inboxID: string }

export type LoopDiagnostics = {
  lastReminderAdmitted?: ReminderEvent
  lastWakeRequested?: ReminderEvent
  lastError?: { at: number; message: string }
}

type SavedLoopDiagnostics = LoopDiagnostics & { version: 1; revision: string }

function latest<T extends { at: number }>(saved: T | undefined, incoming: T | undefined): T | undefined {
  return incoming && (!saved || incoming.at > saved.at) ? incoming : saved
}

export function mergeLoopDiagnostics(saved: LoopDiagnostics, incoming: LoopDiagnostics): LoopDiagnostics {
  const admission = latest(saved.lastReminderAdmitted, incoming.lastReminderAdmitted)
  const wake = latest(saved.lastWakeRequested, incoming.lastWakeRequested)
  const error = latest(saved.lastError, incoming.lastError)
  return {
    ...(admission ? { lastReminderAdmitted: admission } : {}),
    ...(wake ? { lastWakeRequested: wake } : {}),
    ...(error ? { lastError: error } : {}),
  }
}

export function readLoopDiagnostics(value: unknown): SavedLoopDiagnostics | undefined {
  if (value === undefined) return undefined
  const record = asRecord(value)
  if (record.version !== 1 || typeof record.revision !== "string" || !record.revision) {
    throw new Error("Invalid stored orchestrator diagnostics")
  }
  const result: SavedLoopDiagnostics = { version: 1, revision: record.revision }
  for (const name of ["lastReminderAdmitted", "lastWakeRequested", "lastError"] as const) {
    if (record[name] === undefined) continue
    const event = asRecord(record[name])
    if (typeof event.at !== "number" || !Number.isSafeInteger(event.at) || event.at < 0) {
      throw new Error(`Invalid orchestrator diagnostic timestamp: ${name}`)
    }
    if (name === "lastError") {
      if (typeof event.message !== "string") throw new Error("Invalid orchestrator diagnostic error")
      result[name] = { at: event.at, message: event.message }
    } else {
      if (typeof event.inboxID !== "string" || !event.inboxID) throw new Error("Invalid orchestrator diagnostic inbox ID")
      result[name] = { at: event.at, inboxID: event.inboxID }
    }
  }
  return result
}
