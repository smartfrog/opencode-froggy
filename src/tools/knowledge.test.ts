import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createKnowledgeTool } from "./knowledge"

const directories: string[] = []
const context = { agent: "memory-manager", sessionID: "ses_test" }
const reader = { agent: "build", sessionID: "ses_reader" }

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
  it.each([
    ["indentation and trailing whitespace", "    bun test\n    bun run typecheck\n"],
    ["NUL characters, emoji and the final marker", "\u0000😀".repeat(5_000) + "END"],
  ])("preserves knowledge content with %s", async (_name, content) => {
    const memory = tool()
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

  it("summarises topics", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Checks", topic: "build", content: "Run bun test." }, context)
    const content = (await memory.execute({ action: "topics" }, context)).content
    expect(content).toContain("| Topic | Entries |")
    expect(content).toContain("| build | 1 |")
  })

  it("lists knowledge titles and topics without returning full contents", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Checks", topic: "build", content: "Run bun test." }, context)
    const content = (await memory.execute({ action: "list" }, reader)).content
    expect(content).toContain("| K | build | Checks |")
    expect(content).not.toContain("Run bun test.")
  })

  it("renders matching knowledge excerpts", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Build notes", topic: "build", content: "Folders and files are copied." }, context)
    expect((await memory.execute({ action: "search", query: "Folders" }, context)).content).toContain("Folders and files are copied.")
  })

  it("renders knowledge detail metadata and content", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Build notes", topic: "build", content: "Folders and files are copied." }, context)
    const content = (await memory.execute({ action: "get", id: "K" }, context)).content
    expect(content).toContain("**K** — Build notes")
    expect(content).toContain("Topic: build")
    expect(content).toContain("Folders and files are copied.")
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

describe("knowledge writes", () => {
  it("permanently removes knowledge from reads and search", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "wrong", title: "Refuted trick", topic: "performance", content: "Unnecessary workaround." }, context)
    expect(JSON.parse((await memory.execute({ action: "remove", id: "wrong", expectedVersion: 1 }, context)).content)).toMatchObject({ id: "wrong", removed: true })
    await expect(memory.execute({ action: "get", id: "wrong" }, reader)).rejects.toThrow("not found")
    expect((await memory.execute({ action: "search", query: "workaround" }, reader)).content).not.toContain("| wrong |")
  })

  it("rejects stale deletion without removing changed knowledge", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "rule", title: "Memory limit", topic: "constraints", content: "6 GiB limit." }, context)
    await memory.execute({ action: "save", id: "rule", expectedVersion: 1, content: "6 GiB hard ceiling." }, context)
    await expect(memory.execute({ action: "remove", id: "rule", expectedVersion: 1 }, context)).rejects.toThrow("expected version 1, current 2")
    expect((await memory.execute({ action: "get", id: "rule" }, reader)).content).toContain("6 GiB hard ceiling.")
  })

  it.each(["save", "remove"])("rejects knowledge %s by other agents", async (action) => {
    await expect(tool().execute({ action, id: "rule", title: "Rule", topic: "constraints", content: "Keep.", expectedVersion: 1 }, reader)).rejects.toThrow("Only memory-manager")
  })
})
