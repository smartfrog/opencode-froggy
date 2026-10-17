import { describe, expect, it } from "bun:test"
import { mergeLoopDiagnostics } from "./orchestrator-diagnostics"

describe("diagnostic observation merging", () => {
  it("retains the newest observation independently for each event", () => {
    const result = mergeLoopDiagnostics({
      lastReminderAdmitted: { at: 30, inboxID: "msg_new" },
      lastWakeRequested: { at: 10, inboxID: "msg_old" },
      lastError: { at: 40, message: "Newer failure" },
    }, {
      lastReminderAdmitted: { at: 20, inboxID: "msg_old" },
      lastWakeRequested: { at: 20, inboxID: "msg_old" },
      lastError: { at: 20, message: "Older failure" },
    })

    expect(result).toEqual({
      lastReminderAdmitted: { at: 30, inboxID: "msg_new" },
      lastWakeRequested: { at: 20, inboxID: "msg_old" },
      lastError: { at: 40, message: "Newer failure" },
    })
  })

  it("keeps saved observations on a timestamp tie", () => {
    expect(mergeLoopDiagnostics({ lastError: { at: 1, message: "Saved" } }, { lastError: { at: 1, message: "Incoming" } }))
      .toEqual({ lastError: { at: 1, message: "Saved" } })
  })

  it("does not create undefined fields for absent events", () => {
    expect(mergeLoopDiagnostics({}, {})).toEqual({})
  })
})
