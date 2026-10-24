import { rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "bun:test"
import { loadCommands } from "./loaders"
import { createTemporaryDirectory } from "./test-fixtures/temporary-directory"
import { createKnowledgeTool } from "./tools/knowledge"
import { createMemoryOverviewTool } from "./tools/memory-overview"
import { createTaskBoardTool } from "./tools/task-board"

const commands = loadCommands(fileURLToPath(new URL("../command/", import.meta.url)))
const writer = { agent: "memory-manager", sessionID: "ses_test" }
const directories: string[] = []

async function setup(seed = false) {
  const directory = createTemporaryDirectory("froggy-commands-")
  directories.push(directory)
  if (seed) {
    const tasks = createTaskBoardTool(directory)
    const knowledge = createKnowledgeTool(directory)
    await tasks.execute({ action: "save", id: "T1", title: "Fix crash", status: "review", description: "Crash details." }, writer)
    await tasks.execute({ action: "save", id: "T2", title: "Finished task", status: "done" }, writer)
    await knowledge.execute({ action: "save", id: "K1", topic: "build", title: "Build notes", content: "Folders and files are copied." }, writer)
  }
  return directory
}

async function run(tool: { execute(input: unknown, context: unknown): Promise<{ content: string }> }, input: unknown) {
  return (await tool.execute(input, writer)).content
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("memory inspection commands", () => {
  it.each([
    ["memory", "memory-overview", []],
    ["task-board", "task-board", ['status: "done"', 'action: "get"', "$ARGUMENTS"]],
    ["knowledge", "knowledge", ['action: "topics"', 'action: "search"', "$ARGUMENTS"]],
  ])("loads /%s as a relay of %s output", (name, tool, snippets) => {
    const command = commands[name]
    expect(command).toBeDefined()
    expect(command.template).toContain(`\`${tool}\``)
    expect(command.template).toContain("exactly as-is")
    for (const snippet of snippets) expect(command.template).toContain(snippet)
  })
})

describe("tool output used by the commands", () => {
  it("renders the board with one column per status and hides done", async () => {
    const output = await run(createTaskBoardTool(await setup(true)), { action: "list" })
    expect(output).toContain("| todo (0) | in-progress (0) | review (1) | blocked (0) |")
    expect(output).toContain("T1 — Fix crash")
    expect(output).not.toContain("T2")
  })

  it("shows done on request", async () => {
    const output = await run(createTaskBoardTool(await setup(true)), { action: "list", status: "done" })
    expect(output).toContain("| done (1) |")
    expect(output).toContain("T2 — Finished task")
    expect(output).not.toContain("T1")
  })

  it("shows one task with its current description and version", async () => {
    const output = await run(createTaskBoardTool(await setup(true)), { action: "get", id: "T1" })
    expect(output).toContain("**T1** — Fix crash")
    expect(output).toContain("Crash details.")
    expect(output).toContain("Version: 1")
    expect(output).not.toContain("### Notes")
  })

  it("renders the memory overview", async () => {
    const output = await run(createMemoryOverviewTool(await setup(true)), {})
    expect(output).toContain("Store: `")
    expect(output).toContain("| review | 1 |")
    expect(output).toContain("| done | 1 |")
    expect(output).toContain("| build | 1 |")
  })

  it("renders knowledge topics", async () => {
    const output = await run(createKnowledgeTool(await setup(true)), { action: "topics" })
    expect(output).toContain("| Topic | Entries |")
    expect(output).toContain("| build | 1 |")
  })

  it("renders a knowledge list and search excerpts", async () => {
    const knowledge = createKnowledgeTool(await setup(true))
    expect(await run(knowledge, { action: "list" })).toContain("| K1 | build | Build notes |")
    expect(await run(knowledge, { action: "search", query: "Folders" })).toContain("Folders and files are copied.")
  })

  it("renders one knowledge entry", async () => {
    const output = await run(createKnowledgeTool(await setup(true)), { action: "get", id: "K1" })
    expect(output).toContain("**K1** — Build notes")
    expect(output).toContain("Topic: build")
    expect(output).toContain("Folders and files are copied.")
  })
})
