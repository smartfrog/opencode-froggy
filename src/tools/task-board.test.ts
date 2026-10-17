import { rmSync } from "node:fs"
import { afterEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createTaskBoardTool } from "./task-board"

const directories: string[] = []
const context = { agent: "memory-manager", sessionID: "ses_test" }

function tool() {
  const directory = createTemporaryDirectory("froggy-tasks-")
  directories.push(directory)
  return createTaskBoardTool(directory)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("task-board bounded reads", () => {
  it("rejects a stale guarded note without changing notes or task version", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    await memory.execute({ action: "save", id: "T", expectedVersion: 1, status: "review" }, context)
    await expect(memory.execute({ action: "note", id: "T", expectedVersion: 1, note: "Stale progress." }, context)).rejects.toThrow("changed")
    const value = JSON.parse((await memory.execute({ action: "get", id: "T" }, context)).content)
    expect(value.task.version).toBe(2)
    expect(value.notes).toEqual([])
  })
  it("invalidates a pinned read when a new progress note changes its pages", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    await memory.execute({ action: "note", id: "T", note: "Baseline measured." }, context)
    await expect(memory.execute({ action: "get", id: "T", page: 1, expectedVersion: 1 }, context)).rejects.toThrow("changed")
  })
  it("lists every task through simple pages without full descriptions", async () => {
    const memory = tool()
    for (let index = 0; index < 24; index++) await memory.execute({ action: "save", id: `T${index}`, title: "\u0000".repeat(200), description: "Detailed evidence." }, context)
    const ids: string[] = []
    let page: number | null = 0
    while (page !== null) {
      const response = await memory.execute({ action: "list", page }, context)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      const value = JSON.parse(response.content) as { tasks: { id: string; description?: string }[]; nextPage: number | null }
      expect(value.tasks.every((task) => task.description === undefined)).toBe(true)
      ids.push(...value.tasks.map(({ id }) => id))
      page = value.nextPage
    }
    expect(new Set(ids).size).toBe(24)
  })

  it("reads escaped descriptions and short notes completely through pages", async () => {
    const memory = tool()
    const description = "\u0000😀".repeat(8_000) + "END"
    await memory.execute({ action: "save", id: "T", title: "Task", description }, context)
    for (let index = 0; index < 12; index++) await memory.execute({ action: "note", id: "T", note: `${index}:` + "\u0000".repeat(490) }, context)
    let page: number | null = 0
    let rebuilt = ""
    const notes: string[] = []
    while (page !== null) {
      const response = await memory.execute({ action: "get", id: "T", page }, context)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      const value = JSON.parse(response.content) as { task: { description: string }; notes: { note: string }[]; nextPage: number | null }
      rebuilt += value.task.description
      notes.push(...value.notes.map(({ note }) => note))
      page = value.nextPage
    }
    expect(rebuilt).toBe(description)
    expect(notes.length).toBe(12)
  })

  it.each(["orchestrator", "build", "general", "code-reviewer"])("allows reads by %s", async (agent) => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, context)
    expect(JSON.parse((await memory.execute({ action: "get", id: "T" }, { agent })).content).task.id).toBe("T")
  })

  it("requires a current session for memory-manager writes", async () => {
    await expect(tool().execute({ action: "save", id: "T", title: "Task" }, { agent: "memory-manager" })).rejects.toThrow("A current session is required")
  })

  it.each(["objective", "expectedRevision", "field", "item", "offset"])("rejects removed parameter %s rather than ignoring it", async (field) => {
    await expect(tool().execute({ action: "save", id: "T", title: "Task", [field]: "old" }, context)).rejects.toThrow("Unsupported memory parameter")
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER, "0"])("rejects invalid page %j", async (page) => {
    await expect(tool().execute({ action: "list", page }, context)).rejects.toThrow("page")
  })
})
