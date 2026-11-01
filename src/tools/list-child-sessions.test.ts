import { describe, expect, it, mock } from "bun:test"
import { createListChildSessionsTool } from "./list-child-sessions"

const CHILD = { id: "ses_child", parentID: "ses_parent", title: "Current title", created: 1, updated: 2 }
const CONTEXT = { sessionID: "ses_parent" }

describe("persisted child inventory tool", () => {
  it("reads current titles and timestamps on each call", async () => {
    const read = mock().mockResolvedValueOnce([CHILD]).mockResolvedValueOnce([{ ...CHILD, title: "Renamed", updated: 5000 }])
    const tool = createListChildSessionsTool(read)
    const first = await tool.execute({}, CONTEXT)
    expect(read).toHaveBeenCalledWith("ses_parent")
    expect(first.content).toContain("verified")
    expect(first.content).toContain("Current title")

    const result = await tool.execute({}, CONTEXT)

    expect(result.content).toContain("Renamed")
    expect(result.content).toContain("1970-01-01T00:00:05.000Z")
    expect(result.content).not.toContain("Current title")
  })

  it("reports a verified empty list only after persistent discovery succeeds", async () => {
    const tool = createListChildSessionsTool(async () => [])

    const result = await tool.execute({}, CONTEXT)

    expect(result.content).toContain("verified")
    expect(result.content).toContain("No child sessions found")
  })

  it("fails discovery instead of returning a previously successful inventory", async () => {
    const failure = new Error("API offline")
    const read = mock().mockResolvedValueOnce([CHILD]).mockRejectedValueOnce(failure)
    const tool = createListChildSessionsTool(read)
    await tool.execute({}, CONTEXT)

    await expect(tool.execute({}, CONTEXT)).rejects.toMatchObject({ message: expect.stringContaining("unavailable"), cause: failure })
  })

  it("fails explicitly when discovery is unavailable", async () => {
    const failure = new Error("API offline")
    const tool = createListChildSessionsTool(async () => { throw failure })

    await expect(tool.execute({}, CONTEXT)).rejects.toMatchObject({ message: expect.stringContaining("unavailable"), cause: failure })
  })

  it("validates the invoking session before discovery", async () => {
    const read = mock(async () => [])
    const tool = createListChildSessionsTool(read)

    await expect(tool.execute({}, {})).rejects.toThrow("session")
    expect(read).not.toHaveBeenCalled()
  })
})
