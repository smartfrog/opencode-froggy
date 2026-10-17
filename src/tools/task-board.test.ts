import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createTaskBoardTool } from "./task-board"

const directories: string[] = []
const CONTEXT = { agent: "memory-manager", sessionID: "ses_test" }

function tool(): ReturnType<typeof createTaskBoardTool> {
  const directory = mkdtempSync(join(tmpdir(), "froggy-task-board-"))
  directories.push(directory)
  return createTaskBoardTool(directory)
}

function result(value: { content: string }): Record<string, unknown> {
  return JSON.parse(value.content) as Record<string, unknown>
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("task-board tool", () => {
  it("creates and lists compact tasks", async () => {
    const memory = tool()
    expect(result(await memory.execute({
      action: "save",
      id: "GAMEPLAY",
      title: "Reach gameplay",
      nextAction: "Run trial #14",
    }, CONTEXT))).toMatchObject({ id: "GAMEPLAY", revision: 1, created: true })

    expect(result(await memory.execute({ action: "list" }, CONTEXT))).toMatchObject({
      tasks: [{ id: "GAMEPLAY", title: "Reach gameplay", nextAction: "Run trial #14" }],
    })
  })

  it("updates with a revision check and archives the previous state", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, CONTEXT)
    await memory.execute({ action: "save", id: "T", expectedRevision: 1, nextAction: "Next" }, CONTEXT)

    expect(result(await memory.execute({ action: "get", id: "T" }, CONTEXT))).toMatchObject({
      task: { revision: 2, nextAction: "Next" },
    })
    expect(result(await memory.execute({ action: "history", id: "T" }, CONTEXT))).toMatchObject({
      history: [{ revision: 1 }],
    })
  })

  it("bounds long task fields on read", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task", currentState: "x".repeat(5_000) }, CONTEXT)

    expect(result(await memory.execute({ action: "get", id: "T" }, CONTEXT))).toMatchObject({
      task: { truncated: ["currentState"] },
    })
  })

  it("bounds summary fields and reports truncation", async () => {
    const memory = tool()
    for (let index = 0; index < 20; index++) {
      await memory.execute({
        action: "save",
        id: `T${index}`,
        title: `${"title".repeat(100)}-${index}`,
        nextAction: "next".repeat(1000),
      }, CONTEXT)
    }

    const listed = await memory.execute({ action: "list", limit: 20 }, CONTEXT)
    const body = result(listed)
    expect(listed.content.length).toBeLessThanOrEqual(20_000)
    expect((body.tasks as unknown[])[0]).toMatchObject({ truncated: ["title", "nextAction"] })
    expect(body.hasMore).toBe(false)
  })

  it("reads an accepted long field completely through revision-checked ranges", async () => {
    const memory = tool()
    const objective = "A".repeat(4_500) + "TRAILING"
    await memory.execute({ action: "save", id: "T", title: "Task", objective }, CONTEXT)

    expect(result(await memory.execute({ action: "get", id: "T" }, CONTEXT))).toMatchObject({
      task: { truncated: ["objective"] },
    })

    let offset = 0
    let rebuilt = ""
    while (offset !== null) {
      const page = result(await memory.execute({
        action: "get",
        id: "T",
        field: "objective",
        expectedRevision: 1,
        offset,
        limit: 1_000,
      }, CONTEXT)) as { text: string; nextOffset: number | null }
      rebuilt += page.text
      offset = page.nextOffset ?? 0
      if (page.nextOffset === null) break
    }
    expect(rebuilt).toBe(objective)
  })

  it("reads a complete long reference item", async () => {
    const memory = tool()
    const reference = "R".repeat(2_000) + "END"
    await memory.execute({ action: "save", id: "T", title: "Task", evidence: [reference] }, CONTEXT)

    expect(result(await memory.execute({ action: "get", id: "T" }, CONTEXT))).toMatchObject({
      task: { truncated: ["evidence"] },
    })
    expect(result(await memory.execute({
      action: "get",
      id: "T",
      field: "evidence",
      item: 0,
      expectedRevision: 1,
    }, CONTEXT))).toMatchObject({ text: reference })
  })

  it.each(["orchestrator", "build", "general", "code-reviewer"])("rejects task writes by %s", async (agent) => {
    const memory = tool()
    await expect(memory.execute({
      action: "save",
      id: "T",
      title: "Task",
    }, { agent, sessionID: "ses_other" })).rejects.toThrow("Only memory-manager may change tasks")
  })

  it.each(["orchestrator", "build", "general", "code-reviewer"])("allows task reads by %s", async (agent) => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, CONTEXT)

    expect(result(await memory.execute({ action: "get", id: "T" }, { agent, sessionID: "ses_other" }))).toMatchObject({
      task: { id: "T", revision: 1, updatedBy: "memory-manager" },
    })
  })

  it("preserves the task when the coordinator attempts an update", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task", currentState: "Held" }, CONTEXT)

    await expect(memory.execute({
      action: "save", id: "T", expectedRevision: 1, currentState: "Released",
    }, { agent: "orchestrator", sessionID: "ses_other" })).rejects.toThrow("Only memory-manager may change tasks")

    expect(result(await memory.execute({ action: "get", id: "T" }, CONTEXT))).toMatchObject({
      task: { revision: 1, currentState: "Held", updatedBy: "memory-manager" },
    })
    expect(result(await memory.execute({ action: "history", id: "T" }, CONTEXT))).toMatchObject({ history: [] })
  })

  it("requires a current session for memory-manager writes", async () => {
    await expect(tool().execute({ action: "save", id: "T", title: "Task" }, {
      agent: "memory-manager",
    })).rejects.toThrow("A current session is required")
  })

  it("saves related transition fields together in one revision", async () => {
    const memory = tool()
    await memory.execute({
      action: "save", id: "T", title: "Task", currentState: "Held; no worker assigned",
      nextAction: "Obtain coordinator release", blockers: "Coordinator hold", assignments: [],
    }, CONTEXT)

    await memory.execute({
      action: "save", id: "T", expectedRevision: 1,
      currentState: "Hold released; worker dispatched; guest execution unconfirmed",
      nextAction: "Await worker evidence before claiming execution", blockers: "",
      assignments: ["general / ses_worker / monitored trial"],
    }, CONTEXT)

    expect(result(await memory.execute({ action: "get", id: "T" }, CONTEXT))).toMatchObject({
      task: {
        revision: 2, updatedBy: "memory-manager", updatedSession: "ses_test",
        currentState: "Hold released; worker dispatched; guest execution unconfirmed",
        nextAction: "Await worker evidence before claiming execution", blockers: "",
        assignments: ["general / ses_worker / monitored trial"],
      },
    })
    const archived = result(await memory.execute({ action: "history", id: "T", revision: 1 }, CONTEXT))
    expect(JSON.parse(archived.text as string)).toMatchObject({
      revision: 1, currentState: "Held; no worker assigned", blockers: "Coordinator hold", assignments: [],
    })
  })

  it("rejects a stale revision", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "T", title: "Task" }, CONTEXT)
    await memory.execute({ action: "save", id: "T", expectedRevision: 1, nextAction: "Two" }, CONTEXT)

    await expect(memory.execute({
      action: "save",
      id: "T",
      expectedRevision: 1,
      nextAction: "Three",
    }, CONTEXT)).rejects.toThrow("expected revision 1, current 2")
  })
})
