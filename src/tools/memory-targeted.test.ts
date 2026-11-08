import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { openProjectMemory } from "../memory/project"
import { openSqlite } from "../memory/sqlite"
import { createTemporaryDirectory } from "../test-fixtures/temporary-directory"
import { createKnowledgeTool } from "./knowledge"
import { createTaskBoardTool } from "./task-board"

const directories: string[] = []
const writer = { agent: "memory-manager", sessionID: "ses_writer" }
const reader = { agent: "orchestrator" }
const kinds = ["task", "knowledge"] as const

function fixture(kind: typeof kinds[number]) {
  const directory = createTemporaryDirectory("froggy-targeted-")
  directories.push(directory)
  const tool = kind === "task" ? createTaskBoardTool(directory) : createKnowledgeTool(directory)
  const body = kind === "task" ? "description" : "content"
  const seed = (content: string) => tool.execute({ action: "save", id: "R", title: "Record", ...(kind === "knowledge" ? { topic: "build" } : {}), [body]: content }, writer)
  const snapshot = () => {
    const { store } = openProjectMemory(directory, { readonly: true })
    try {
      return {
        record: kind === "task" ? store.getTask("R") : store.getNote("R"),
        history: store.listRevisions(kind, "R"),
        search: store.listNotes({ query: "original" }),
      }
    } finally { store.close() }
  }
  return { directory, tool, seed, snapshot }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe.each(kinds)("%s literal grep", (kind) => {
  it("returns merged body context and version without changing persistent files", async () => {
    const { directory, tool, seed } = fixture(kind)
    await seed("one\r\n😀 .*\r\nthree\r\nfour .*\r\nfive\r\nsix\r\nseven\r\neight\r\nnine .*\r\n")
    const path = join(directory, ".opencode", "memory")
    const files = readdirSync(path)
    const persistentFiles = files.filter((file) => !file.endsWith("-shm"))
    const before = persistentFiles.map((file) => readFileSync(join(path, file)))
    const result = await tool.execute({ action: "grep", id: "R", pattern: ".*", context: 1 }, reader)
    expect(result.content).toBe("**R** — Record\n\nVersion: 1\nMatching lines: 3 (complete)\n\n1: one\r\n2: 😀 .*\r\n3: three\r\n4: four .*\r\n5: five\r\n--\n8: eight\r\n9: nine .*\r\n10: ")
    expect(readdirSync(path)).toEqual(files)
    expect(persistentFiles.map((file) => readFileSync(join(path, file)))).toEqual(before)
  })

  it("defaults to two context lines", async () => {
    const { tool, seed } = fixture(kind)
    await seed("zero\none\nNeedle\nthree\nfour\nfive")
    const result = await tool.execute({ action: "grep", id: "R", pattern: "Needle" }, reader)
    expect(result.content).toContain("1: zero\n2: one\n3: Needle\n4: three\n5: four")
    expect(result.content).not.toContain("6: five")
  })

  it("reports no matches for a differently cased literal", async () => {
    const { tool, seed } = fixture(kind)
    await seed("Needle")
    expect((await tool.execute({ action: "grep", id: "R", pattern: "needle" }, reader)).content).toBe("**R** — Record\n\nVersion: 1\nNo matches (complete)")
  })

  it("merges adjacent context windows without duplicate lines", async () => {
    const { tool, seed } = fixture(kind)
    await seed("one\nmatch match\nthree\nfour\nmatch\nsix")
    const result = await tool.execute({ action: "grep", id: "R", pattern: "match", context: 1 }, reader)
    expect(result.content).toBe("**R** — Record\n\nVersion: 1\nMatching lines: 2 (complete)\n\n1: one\n2: match match\n3: three\n4: four\n5: match\n6: six")
  })

  it("accepts the maximum context and reports the updated current version", async () => {
    const { tool, seed } = fixture(kind)
    await seed("original\nmatch\nlast")
    await tool.execute({ action: "save", id: "R", expectedVersion: 1, title: "Updated" }, writer)
    expect((await tool.execute({ action: "grep", id: "R", pattern: "match", context: 10 }, reader)).content).toBe("**R** — Updated\n\nVersion: 2\nMatching lines: 1 (complete)\n\n1: original\n2: match\n3: last")
  })

  it("does not clip large matching output", async () => {
    const { tool, seed } = fixture(kind)
    const content = "x".repeat(70_000) + "END"
    await seed(content)
    expect((await tool.execute({ action: "grep", id: "R", pattern: "END", context: 0 }, reader)).content).toContain(`1: ${content}`)
  })

  it("reports a missing record without changing memory", async () => {
    const { tool, seed, snapshot } = fixture(kind)
    await seed("original")
    const before = snapshot()
    await expect(tool.execute({ action: "grep", id: "missing", pattern: "x" }, reader)).rejects.toThrow("not found")
    expect(snapshot()).toEqual(before)
  })

  it("does not create a missing store", async () => {
    const { tool, directory } = fixture(kind)
    await expect(tool.execute({ action: "grep", id: "R", pattern: "x" }, reader)).rejects.toThrow("No project memory database")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })
})

describe.each(kinds)("%s guarded edit", (kind) => {
  it("matches the original only and preserves untouched literal text", async () => {
    const { tool, seed } = fixture(kind)
    await seed("  😀\r\nalpha\nbeta\r\n$&\\ tail\n")
    const result = JSON.parse((await tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [
      { oldText: "alpha", newText: "beta" }, { oldText: "beta", newText: "$&\\😀\n" },
    ] }, writer)).content)
    expect(result).toMatchObject({ id: "R", version: 2, created: false })
    expect(result).not.toHaveProperty("content")
    expect(result).not.toHaveProperty("description")
    expect((await tool.execute({ action: "get", id: "R" }, reader)).content).toContain("  😀\r\nbeta\n$&\\😀\n\r\n$&\\ tail\n")
  })

  it("replaces multiline old text literally", async () => {
    const { tool, seed } = fixture(kind)
    await seed("prefix\r\n😀 one\r\ntwo\nsuffix\r\n")
    await tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "😀 one\r\ntwo\n", newText: "é $&\\\n" }] }, writer)
    expect((await tool.execute({ action: "get", id: "R" }, reader)).content).toContain("prefix\r\né $&\\\nsuffix\r\n")
  })

  it.each([
    ["original alpha", [{ oldText: "alpha", newText: "created" }, { oldText: "created", newText: "wrong" }]],
    ["original alpha", [{ oldText: "alpha", newText: "ok" }, { oldText: "absent", newText: "wrong" }]],
    ["original aa aa", [{ oldText: "aa", newText: "wrong" }]],
    ["original aaa", [{ oldText: "aa", newText: "wrong" }]],
    ["original abc", [{ oldText: "ab", newText: "one" }, { oldText: "bc", newText: "two" }]],
    ["original abc", [{ oldText: "abc", newText: "one" }, { oldText: "abc", newText: "two" }]],
  ] as const)("rejects the whole ambiguous or missing batch %j %j", async (content, edits) => {
    const { tool, seed, snapshot } = fixture(kind)
    await seed(content)
    const before = snapshot()
    await expect(tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits }, writer)).rejects.toThrow()
    expect(snapshot()).toEqual(before)
  })

  it("preserves timestamp, history and search for effective no-ops", async () => {
    const { tool, seed, snapshot } = fixture(kind)
    await seed("original alpha beta")
    await tool.execute({ action: "save", id: "R", expectedVersion: 1, title: "Current title" }, writer)
    const before = snapshot()
    const receipt = JSON.parse((await tool.execute({ action: "edit", id: "R", expectedVersion: 2, edits: [
      { oldText: "alpha ", newText: "alpha" }, { oldText: "beta", newText: " beta" },
    ] }, writer)).content)
    expect(receipt.version).toBe(2)
    expect(snapshot()).toEqual(before)
  })

  it("checks stale versions before matching even identical edits", async () => {
    const { tool, seed, snapshot } = fixture(kind)
    await seed("original")
    const before = snapshot()
    await expect(tool.execute({ action: "edit", id: "R", expectedVersion: 2, edits: [{ oldText: "absent", newText: "absent" }] }, writer)).rejects.toThrow("expected version 2, current 1")
    expect(snapshot()).toEqual(before)
  })

  it("does not create a missing store", async () => {
    const { tool, directory } = fixture(kind)
    await expect(tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "x", newText: "y" }] }, writer)).rejects.toThrow("No project memory database")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })

  it("does not create a missing record", async () => {
    const { tool, seed, snapshot } = fixture(kind)
    await seed("original")
    const before = snapshot()
    await expect(tool.execute({ action: "edit", id: "missing", expectedVersion: 1, edits: [{ oldText: "x", newText: "y" }] }, writer)).rejects.toThrow("not found")
    expect(snapshot()).toEqual(before)
  })

  it("allows literal deletion without changing metadata", async () => {
    const { tool, seed, snapshot } = fixture(kind)
    await seed("original removable tail")
    const before = snapshot().record
    await tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: " removable", newText: "" }] }, writer)
    const body = kind === "task" ? { description: "original tail" } : { content: "original tail" }
    expect(snapshot().record).toMatchObject({ ...before, ...body, version: 2, updatedAt: expect.any(Number) })
  })

  it("retains one previous version and restores through the manager", async () => {
    const { tool, seed, snapshot } = fixture(kind)
    await seed("original")
    const edited = JSON.parse((await tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "original", newText: "revised" }] }, writer)).content)
    expect(snapshot().history.map(({ version }) => version)).toEqual([edited.version, 1])
    await tool.execute({ action: "restore", id: "R", expectedVersion: edited.version, restoreVersion: 1 }, writer)
    expect((await tool.execute({ action: "get", id: "R" }, reader)).content).toContain("original")
    expect(snapshot().history).toHaveLength(2)
  })
})

describe.each(kinds)("%s targeted argument validation", (kind) => {
  it.each([
    { action: "grep", id: "R" },
    ...["", null, 1, "a\nb", "a\rb"].map((pattern) => ({ action: "grep", id: "R", pattern })),
    ...[-1, 11, 0.5, Number.MAX_SAFE_INTEGER + 1, "2", null].map((context) => ({ action: "grep", id: "R", pattern: "x", context })),
    { action: "grep", pattern: "x" },
    ...["title", "status", "topic", "content", "description", "query", "version", "offset", "limit", "expectedVersion", "restoreVersion", "edits"].map((field) => ({ action: "grep", id: "R", pattern: "x", [field]: 1 })),
    ...["get", "save", "history", "list", "restore"].flatMap((action) => ["pattern", "context", "edits"].map((field) => ({ action, id: "R", [field]: "x" }))),
    { action: "edit", expectedVersion: 1, edits: [{ oldText: "x", newText: "y" }] },
    { action: "edit", id: "R", edits: [{ oldText: "x", newText: "y" }] },
    ...[0, -1, 1.5, "1", null].map((expectedVersion) => ({ action: "edit", id: "R", expectedVersion, edits: [{ oldText: "x", newText: "y" }] })),
    ...[undefined, [], {}, [null], [{ oldText: "", newText: "y" }], [{ oldText: 1, newText: "y" }], [{ oldText: "x", newText: 1 }], [{ oldText: "x" }], [{ oldText: "x", newText: "y", extra: true }]].map((edits) => ({ action: "edit", id: "R", expectedVersion: 1, edits })),
    ...["title", "status", "topic", "content", "description", "query", "version", "offset", "limit", "pattern", "context", "restoreVersion"].map((field) => ({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "x", newText: "y" }], [field]: 1 })),
  ])("rejects malformed or misplaced arguments before opening memory: %j", async (input) => {
    const { tool, directory } = fixture(kind)
    await expect(tool.execute(input, writer)).rejects.toThrow()
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })

  it.each(["grep", "edit"])("does not migrate outdated memory for %s", async (action) => {
    const { tool, directory, seed } = fixture(kind)
    await seed("original")
    const memoryDirectory = join(directory, ".opencode", "memory")
    const path = join(memoryDirectory, "memory.db")
    const database = openSqlite(path)
    try { database.exec("PRAGMA user_version=3") } finally { database.close() }
    const before = readFileSync(path)
    const files = readdirSync(memoryDirectory)
    const args = action === "grep" ? { pattern: "original" } : { expectedVersion: 1, edits: [{ oldText: "original", newText: "revised" }] }
    await expect(tool.execute({ action, id: "R", ...args }, writer)).rejects.toThrow("current memory schema")
    expect(readFileSync(path)).toEqual(before)
    expect(readdirSync(memoryDirectory)).toEqual(files)
  })

  it.each([undefined, "", "Memory-manager", "memory-manager ", "memory-manager-worker", "orchestrator"])("rejects edit identity %j", async (agent) => {
    const { tool, directory } = fixture(kind)
    await expect(tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "x", newText: "y" }] }, { agent, sessionID: "ses_test" })).rejects.toThrow("Only memory-manager")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })

  it.each([undefined, "", null, 7, [], {}])("rejects edit without current session %j", async (sessionID) => {
    const { tool, directory } = fixture(kind)
    await expect(tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "x", newText: "y" }] }, { agent: "memory-manager", sessionID })).rejects.toThrow("current session")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })

  it.each([{ agent: "memory-manager" }, { sessionID: "ses_writer" }, { context: writer }])("rejects forged edit identity %j", async (identity) => {
    const { tool, directory } = fixture(kind)
    await expect(tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "x", newText: "y" }], ...identity }, reader)).rejects.toThrow("context" in identity ? "Only memory-manager" : "Unsupported memory parameter")
    expect(existsSync(join(directory, ".opencode"))).toBe(false)
  })
})

it("updates knowledge full-text search after an edit", async () => {
  const { tool, seed } = fixture("knowledge")
  await seed("original searchable")
  await tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "searchable", newText: "replacementtoken" }] }, writer)
  expect((await tool.execute({ action: "search", query: "searchable" }, reader)).content).not.toContain("| R |")
  expect((await tool.execute({ action: "search", query: "replacementtoken" }, reader)).content).toContain("| R |")
})

it("rejects blank knowledge content without changing its state", async () => {
  const { tool, seed, snapshot } = fixture("knowledge")
  await seed("original")
  const before = snapshot()
  await expect(tool.execute({ action: "edit", id: "R", expectedVersion: 1, edits: [{ oldText: "original", newText: "" }] }, writer)).rejects.toThrow("content is required")
  expect(snapshot()).toEqual(before)
})
