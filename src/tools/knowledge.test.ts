import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createKnowledgeTool } from "./knowledge"

const directories: string[] = []
const context = { agent: "memory-manager", sessionID: "ses_test" }

function tool() {
  const directory = createTemporaryDirectory("froggy-knowledge-")
  directories.push(directory)
  return createKnowledgeTool(directory)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("knowledge read safety", () => {
  it.each([
    { action: "topics" },
    { action: "list" },
    { action: "search", query: "anything" },
    { action: "get", id: "K" },
  ])("does not create a database for %j", async (input) => {
    const memory = tool()
    await expect(memory.execute(input, context)).rejects.toThrow("No project memory database exists")
    expect(existsSync(join(directories[0], ".opencode"))).toBe(false)
  })
})

describe("knowledge markdown reads", () => {
  it("preserves Markdown indentation and trailing whitespace exactly", async () => {
    const memory = tool()
    const content = "    bun test\n    bun run typecheck\n"
    await memory.execute({ action: "save", id: "K", title: "Checks", topic: "build", content }, context)
    expect((await memory.execute({ action: "get", id: "K" }, context)).content).toContain(content)
  })

  it("lists every matching entry in one search", async () => {
    const memory = tool()
    for (let index = 0; index < 17; index++) {
      await memory.execute({ action: "save", id: `K${index}`, title: `Note ${index}`, topic: "build", content: "Find me" }, context)
    }
    const content = (await memory.execute({ action: "search", query: "Find me" }, context)).content
    expect(content.match(/\| K\d+ \|/g)).toHaveLength(17)
  })

  it("summarises topics and renders a list", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Checks", topic: "build", content: "Run bun test." }, context)
    expect((await memory.execute({ action: "topics" }, context)).content).toContain("| build | 1 |")
    expect((await memory.execute({ action: "list" }, context)).content).toContain("| K | build | Checks |")
  })

  it("reads an escaped knowledge entry completely", async () => {
    const memory = tool()
    const content = "\u0000😀".repeat(5_000) + "END"
    await memory.execute({ action: "save", id: "K", title: "Knowledge", topic: "constraints", content }, context)
    expect((await memory.execute({ action: "get", id: "K" }, context)).content).toContain(content)
  })

  it("rejects expectedVersion on reads", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Knowledge", topic: "constraints", content: "Keep." }, context)
    await expect(memory.execute({ action: "get", id: "K", expectedVersion: 1 }, context)).rejects.toThrow("only valid for writes")
  })

  it("preserves a large entry through a title update", async () => {
    const memory = tool()
    const content = "x".repeat(70_000)
    await memory.execute({ action: "save", id: "K", title: "Knowledge", topic: "constraints", content }, context)
    await memory.execute({ action: "save", id: "K", expectedVersion: 1, title: "Renamed" }, context)
    const rendered = (await memory.execute({ action: "get", id: "K" }, context)).content
    expect(rendered).toContain(content)
    expect(rendered).toContain("Renamed")
  })

  it("filters search results by topic", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "build", title: "Build", topic: "build", content: "Shared text" }, context)
    await memory.execute({ action: "save", id: "runtime", title: "Runtime", topic: "runtime", content: "Shared text" }, context)
    const content = (await memory.execute({ action: "search", query: "Shared text", topic: "build" }, context)).content
    expect(content).toContain("| build | build | Build |")
    expect(content).not.toContain("| runtime |")
  })

  it("requires a version for permanent removal", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Knowledge", topic: "constraints", content: "Keep." }, context)
    await expect(memory.execute({ action: "remove", id: "K" }, context)).rejects.toThrow("expectedVersion is required")
  })

  it.each(["overview", "history"])("rejects removed action %s", async (action) => {
    await expect(tool().execute({ action }, context)).rejects.toThrow("action must be")
  })

  it.each(["kind", "status", "sources", "supersededBy", "expectedRevision", "page", "format"])("rejects removed parameter %s", async (field) => {
    await expect(tool().execute({ action: "list", [field]: "old" }, context)).rejects.toThrow("Unsupported memory parameter")
  })

  it.each([null, 0, -1, 1.5, "1"])("rejects invalid version %j", async (expectedVersion) => {
    await expect(tool().execute({ action: "remove", id: "K", expectedVersion }, context)).rejects.toThrow("expectedVersion must be")
  })
})
