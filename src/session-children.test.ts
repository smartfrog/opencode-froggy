import { describe, it, expect } from "vitest"
import { ChildSessionTracker } from "./session-children"

describe("ChildSessionTracker", () => {
  it("should return empty list for unknown parent", () => {
    expect(new ChildSessionTracker().listChildren("ses_unknown")).toEqual([])
  })

  it("should track and list children in creation order", () => {
    const tracker = new ChildSessionTracker()
    tracker.trackChild({ id: "ses_b", parentID: "ses_a", created: 2, updated: 2 })
    tracker.trackChild({ id: "ses_c", parentID: "ses_a", created: 1, updated: 3 })
    expect(tracker.listChildren("ses_a").map((c) => c.id)).toEqual(["ses_c", "ses_b"])
  })

  it("should return the last child", () => {
    const tracker = new ChildSessionTracker()
    tracker.trackChild({ id: "ses_b", parentID: "ses_a", created: 1, updated: 1 })
    tracker.trackChild({ id: "ses_c", parentID: "ses_a", created: 2, updated: 2 })
    expect(tracker.lastChild("ses_a")?.id).toBe("ses_c")
  })

  it("should remove sessions and their children", () => {
    const tracker = new ChildSessionTracker()
    tracker.trackChild({ id: "ses_b", parentID: "ses_a", created: 1, updated: 1 })
    tracker.removeSession("ses_a")
    expect(tracker.listChildren("ses_a")).toEqual([])
  })
})
