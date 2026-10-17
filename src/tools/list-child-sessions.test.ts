import { describe, expect, it, vi } from "vitest"
import { ChildSessionTracker } from "../session-children"
import { createListChildSessionsTool } from "./list-child-sessions"

const CHILD = { id: "ses_child", parentID: "ses_parent", title: "Current title", created: 1, updated: 2 }
const CONTEXT = { sessionID: "ses_parent" }

describe("persisted child inventory tool", () => {
  it("retrieves existing children with an empty event registry", async () => {
    const read = vi.fn(async () => [CHILD])
    const tool = createListChildSessionsTool(new ChildSessionTracker(), read)

    const result = await tool.execute({}, CONTEXT)

    expect(read).toHaveBeenCalledWith("ses_parent")
    expect(result.content).toContain("verified")
    expect(result.content).toContain("Current title")
  })

  it("refreshes cached titles and timestamps on each call", async () => {
    const read = vi.fn().mockResolvedValueOnce([CHILD]).mockResolvedValueOnce([{ ...CHILD, title: "Renamed", updated: 5000 }])
    const tool = createListChildSessionsTool(new ChildSessionTracker(), read)
    await tool.execute({}, CONTEXT)

    const result = await tool.execute({}, CONTEXT)

    expect(result.content).toContain("Renamed")
    expect(result.content).toContain("1970-01-01T00:00:05.000Z")
    expect(result.content).not.toContain("Current title")
  })

  it("reports a verified empty list only after persistent discovery succeeds", async () => {
    const tracker = new ChildSessionTracker()
    tracker.trackChild(CHILD)
    const tool = createListChildSessionsTool(tracker, async () => [])

    const result = await tool.execute({}, CONTEXT)

    expect(result.content).toContain("verified")
    expect(result.content).toContain("No child sessions found")
    expect(tracker.listChildren("ses_parent")).toEqual([])
  })

  it("labels cached results incomplete and includes the discovery error", async () => {
    const tracker = new ChildSessionTracker()
    tracker.trackChild(CHILD)
    const tool = createListChildSessionsTool(tracker, async () => { throw new Error("API offline") })

    const result = await tool.execute({}, CONTEXT)

    expect(result.content).toContain("incomplete")
    expect(result.content).toContain("API offline")
    expect(result.content).toContain(CHILD.id)
  })

  it("fails explicitly when neither discovery nor cached inventory is available", async () => {
    const failure = new Error("API offline")
    const tool = createListChildSessionsTool(new ChildSessionTracker(), async () => { throw failure })

    await expect(tool.execute({}, CONTEXT)).rejects.toMatchObject({ message: expect.stringContaining("unavailable"), cause: failure })
  })

  it("validates the invoking session before discovery", async () => {
    const read = vi.fn(async () => [])
    const tool = createListChildSessionsTool(new ChildSessionTracker(), read)

    await expect(tool.execute({}, {})).rejects.toThrow("session")
    expect(read).not.toHaveBeenCalled()
  })
})
