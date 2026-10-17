import { rmSync } from "node:fs"
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

describe("knowledge bounded reads", () => {
  it("preserves Markdown indentation and trailing whitespace exactly", async () => {
    const memory = tool()
    const content = "    bun test\n    bun run typecheck\n"
    await memory.execute({ action: "save", id: "K", title: "Checks", topic: "build", content }, context)
    expect(JSON.parse((await memory.execute({ action: "get", id: "K" }, context)).content).note.content).toBe(content)
  })
  it("finds every matching entry through bounded search pages", async () => {
    const memory = tool()
    for (let index = 0; index < 17; index++) await memory.execute({ action: "save", id: `K${index}`, title: "\u0000".repeat(200), topic: "\u0000".repeat(80), content: "Find me " + "\u0000".repeat(300) }, context)
    const ids: string[] = []
    let page: number | null = 0
    while (page !== null) {
      const response = await memory.execute({ action: "search", query: "Find me", page }, context)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      const value = JSON.parse(response.content) as { results: { id: string }[]; nextPage: number | null }
      ids.push(...value.results.map(({ id }) => id))
      page = value.nextPage
    }
    expect(new Set(ids).size).toBe(17)
  })

  it("reads an escaped knowledge entry completely through version-pinned pages", async () => {
    const memory = tool()
    const content = "\u0000😀".repeat(9_000) + "END"
    const saved = JSON.parse((await memory.execute({ action: "save", id: "K", title: "Knowledge", topic: "constraints", content }, context)).content) as { version: number }
    let page: number | null = 0
    let rebuilt = ""
    while (page !== null) {
      const response = await memory.execute({ action: "get", id: "K", page, expectedVersion: saved.version }, context)
      expect(response.content.length).toBeLessThanOrEqual(20_000)
      const value = JSON.parse(response.content) as { note: { content: string }; nextPage: number | null }
      rebuilt += value.note.content
      page = value.nextPage
    }
    expect(rebuilt).toBe(content)
  })

  it("rejects a read pinned to an outdated version", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Knowledge", topic: "constraints", content: "Original." }, context)
    await memory.execute({ action: "save", id: "K", expectedVersion: 1, content: "Corrected." }, context)
    await expect(memory.execute({ action: "get", id: "K", expectedVersion: 1 }, context)).rejects.toThrow("changed")
  })

  it("requires a version for permanent removal", async () => {
    const memory = tool()
    await memory.execute({ action: "save", id: "K", title: "Knowledge", topic: "constraints", content: "Keep." }, context)
    await expect(memory.execute({ action: "remove", id: "K" }, context)).rejects.toThrow("expectedVersion is required")
  })

  it.each(["overview", "history"])("rejects removed action %s", async (action) => {
    await expect(tool().execute({ action }, context)).rejects.toThrow("action must be")
  })

  it.each(["kind", "status", "sources", "supersededBy", "expectedRevision"])("rejects removed parameter %s", async (field) => {
    await expect(tool().execute({ action: "list", [field]: "old" }, context)).rejects.toThrow("Unsupported memory parameter")
  })

  it.each([null, 0, -1, 1.5, "1"])("rejects invalid version %j", async (expectedVersion) => {
    await expect(tool().execute({ action: "remove", id: "K", expectedVersion }, context)).rejects.toThrow("expectedVersion must be")
  })
})
