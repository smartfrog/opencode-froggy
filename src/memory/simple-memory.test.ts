import { rmSync } from "node:fs"
import { afterEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createKnowledgeTool } from "../tools/knowledge"
import { createTaskBoardTool } from "../tools/task-board"

const directories: string[] = []
const manager = { agent: "memory-manager", sessionID: "ses_memory" }
const reader = { agent: "build", sessionID: "ses_reader" }

function tools() {
  const directory = createTemporaryDirectory("simple-memory-")
  directories.push(directory)
  return { directory, tasks: createTaskBoardTool(directory), knowledge: createKnowledgeTool(directory) }
}

function body(value: { content: string }) {
  return JSON.parse(value.content)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("simple project memory", () => {
  it("stores a detailed task description", async () => {
    const { tasks } = tools()
    await tasks.execute({ action: "save", id: "PERF", title: "Measure idle", description: "Measure before changing the scheduler.", status: "review" }, manager)
    expect(body(await tasks.execute({ action: "get", id: "PERF" }, reader))).toMatchObject({
      task: { description: "Measure before changing the scheduler.", status: "review", version: 1 }, notes: [],
    })
  })

  it("adds a short progress note without changing the task description", async () => {
    const { tasks } = tools()
    await tasks.execute({ action: "save", id: "PERF", title: "Measure idle", description: "Keep the original scope." }, manager)
    await tasks.execute({ action: "note", id: "PERF", note: "Baseline measured; report: reports/idle.md" }, manager)
    expect(body(await tasks.execute({ action: "get", id: "PERF" }, reader))).toMatchObject({
      task: { description: "Keep the original scope." }, notes: [{ note: "Baseline measured; report: reports/idle.md" }],
    })
  })

  it("rejects progress logs longer than 500 characters", async () => {
    const { tasks } = tools()
    await tasks.execute({ action: "save", id: "T", title: "Task" }, manager)
    await expect(tasks.execute({ action: "note", id: "T", note: "x".repeat(501) }, manager)).rejects.toThrow("500")
  })

  it("rejects stale task updates", async () => {
    const { tasks } = tools()
    await tasks.execute({ action: "save", id: "T", title: "Task" }, manager)
    await tasks.execute({ action: "save", id: "T", expectedVersion: 1, status: "review" }, manager)
    await expect(tasks.execute({ action: "save", id: "T", expectedVersion: 1, status: "done" }, manager)).rejects.toThrow("expected version 1, current 2")
  })

  it("lists knowledge titles and topics without returning full contents", async () => {
    const { knowledge } = tools()
    await knowledge.execute({ action: "save", id: "idle", title: "Idle scheduling", topic: "performance", content: "Measure cycle accounting." }, manager)
    const listed = body(await knowledge.execute({ action: "list" }, reader))
    expect(listed.results).toMatchObject([{ id: "idle", topic: "performance", title: "Idle scheduling" }])
    expect(listed.results[0]).not.toHaveProperty("content")
  })

  it("permanently removes knowledge from reads and search", async () => {
    const { knowledge } = tools()
    await knowledge.execute({ action: "save", id: "wrong", title: "Refuted trick", topic: "performance", content: "Unnecessary workaround." }, manager)
    expect(body(await knowledge.execute({ action: "remove", id: "wrong", expectedVersion: 1 }, manager))).toMatchObject({ id: "wrong", removed: true })
    await expect(knowledge.execute({ action: "get", id: "wrong" }, reader)).rejects.toThrow("not found")
    expect(body(await knowledge.execute({ action: "search", query: "workaround" }, reader)).results).toEqual([])
  })

  it("rejects stale deletion without removing changed knowledge", async () => {
    const { knowledge } = tools()
    await knowledge.execute({ action: "save", id: "rule", title: "Memory limit", topic: "constraints", content: "6 GiB limit." }, manager)
    await knowledge.execute({ action: "save", id: "rule", expectedVersion: 1, content: "6 GiB hard ceiling." }, manager)
    await expect(knowledge.execute({ action: "remove", id: "rule", expectedVersion: 1 }, manager)).rejects.toThrow("expected version 1, current 2")
    expect(body(await knowledge.execute({ action: "get", id: "rule" }, reader)).note.content).toBe("6 GiB hard ceiling.")
  })

  it.each(["save", "remove"])("rejects knowledge %s by other agents", async (action) => {
    const { knowledge } = tools()
    await expect(knowledge.execute({ action, id: "rule", title: "Rule", topic: "constraints", content: "Keep.", expectedVersion: 1 }, reader)).rejects.toThrow("Only memory-manager")
  })

  it.each(["save", "note"])("rejects task %s by other agents", async (action) => {
    const { tasks } = tools()
    await expect(tasks.execute({ action, id: "T", title: "Task", note: "Done." }, reader)).rejects.toThrow("Only memory-manager")
  })
})
