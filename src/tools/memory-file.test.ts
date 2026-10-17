import { createHash } from "node:crypto"
import { closeSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as fs from "node:fs"
import { afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test"
import { createMemoryFileTool } from "./memory-file"

const CONTEXT = { agent: "memory-manager", sessionID: "ses_memory" }
const PATH = ".opencode/backlog/TASK.md"
const hash = (text: string) => createHash("sha256").update(text).digest("hex")

const actualFs = { writeFileSync: fs.writeFileSync, unlinkSync: fs.unlinkSync, closeSync: fs.closeSync, renameSync: fs.renameSync }
let writeFileSyncSpy: ReturnType<typeof jest.spyOn<typeof fs, "writeFileSync">>
let unlinkSyncSpy: ReturnType<typeof jest.spyOn<typeof fs, "unlinkSync">>
let closeSyncSpy: ReturnType<typeof jest.spyOn<typeof fs, "closeSync">>
let renameSyncSpy: ReturnType<typeof jest.spyOn<typeof fs, "renameSync">>

describe("guarded memory files", () => {
  let directory: string
  let tool: ReturnType<typeof createMemoryFileTool>

  beforeEach(() => {
    writeFileSyncSpy = jest.spyOn(fs, "writeFileSync")
    unlinkSyncSpy = jest.spyOn(fs, "unlinkSync")
    closeSyncSpy = jest.spyOn(fs, "closeSync")
    renameSyncSpy = jest.spyOn(fs, "renameSync")
    directory = mkdtempSync(join(tmpdir(), "froggy-memory-"))
    mkdirSync(join(directory, ".opencode/backlog"), { recursive: true })
    writeFileSync(join(directory, PATH), "Original evidence\n")
    tool = createMemoryFileTool(directory)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  it("returns the source hash with its content", async () => {
    const result = await tool.execute({ action: "read", path: PATH }, CONTEXT)
    expect(JSON.parse(result.content)).toMatchObject({ hash: hash("Original evidence\n"), content: "Original evidence\n" })
  })

  it("is exposed directly without granting the execute wrapper", () => {
    expect(tool).toHaveProperty("options.codemode", false)
  })

  it("archives the complete original before saving", async () => {
    const result = await tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Current result\n" }, CONTEXT)
    const receipt = JSON.parse(result.content)
    expect(readFileSync(receipt.archive, "utf8")).toBe("Original evidence\n")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Current result\n")
    expect(receipt.hash).toBe(hash("Current result\n"))
  })

  it("rejects a stale source without replacing it", async () => {
    writeFileSync(join(directory, PATH), "Concurrent update\n")
    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Stale rewrite" }, CONTEXT)).rejects.toThrow("Source changed")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Concurrent update\n")
  })

  it("returns no change without archiving an unchanged file", async () => {
    const result = await tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Original evidence\n" }, CONTEXT)
    expect(JSON.parse(result.content).changed).toBe(false)
    expect(readdirSync(join(directory, ".opencode"))).toEqual(["backlog"])
  })

  it("creates an explicitly absent memory file", async () => {
    await tool.execute({ action: "write", path: ".opencode/orchestrator/learnings.md", expectedHash: null, content: "Useful fact" }, CONTEXT)
    expect(readFileSync(join(directory, ".opencode/orchestrator/learnings.md"), "utf8")).toBe("Useful fact")
  })

  it("reports the full soft budget for absent project knowledge", async () => {
    const result = await tool.execute({ action: "read", path: ".opencode/orchestrator/learnings.md" }, CONTEXT)

    expect(JSON.parse(result.content)).toMatchObject({
      hash: null, content: null, bytes: 0, characters: 0, characterUnit: "unicode-code-points",
      budget: { targetCharacters: 5000, remainingCharacters: 5000, excessCharacters: 0, hardLimit: false },
    })
  })

  it.each(["read", "write", "unchanged"])("counts Unicode code points separately from UTF-8 bytes on %s", async (operation) => {
    const path = ".opencode/orchestrator/learnings.md"
    const content = "é🐸e\u0301"
    mkdirSync(join(directory, ".opencode/orchestrator"), { recursive: true })
    if (operation !== "write") writeFileSync(join(directory, path), content)

    const result = await tool.execute(operation === "read"
      ? { action: "read", path }
      : { action: "write", path, expectedHash: operation === "write" ? null : hash(content), content }, CONTEXT)

    expect(JSON.parse(result.content)).toMatchObject({
      bytes: 9, characters: 4, characterUnit: "unicode-code-points",
      budget: { targetCharacters: 5000, remainingCharacters: 4996, excessCharacters: 0, hardLimit: false },
    })
  })

  it("saves over-budget knowledge intact and reports the excess rather than rejecting it", async () => {
    const path = ".opencode/orchestrator/learnings.md"
    const content = "🐸".repeat(5001)

    const result = await tool.execute({ action: "write", path, expectedHash: null, content }, CONTEXT)

    expect(JSON.parse(result.content)).toMatchObject({
      bytes: 20004, characters: 5001,
      budget: { targetCharacters: 5000, remainingCharacters: 0, excessCharacters: 1, hardLimit: false },
    })
    expect(readFileSync(join(directory, path), "utf8")).toBe(content)
  })

  it("reports neither remaining capacity nor excess exactly at the soft target", async () => {
    const result = await tool.execute({ action: "write", path: ".opencode/orchestrator/learnings.md", expectedHash: null, content: "x".repeat(5000) }, CONTEXT)

    expect(JSON.parse(result.content)).toMatchObject({
      characters: 5000,
      budget: { targetCharacters: 5000, remainingCharacters: 0, excessCharacters: 0, hardLimit: false },
    })
  })

  it("does not apply the knowledge budget to operational tickets", async () => {
    const content = "x".repeat(6000)

    const result = await tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content }, CONTEXT)

    expect(JSON.parse(result.content)).toMatchObject({ bytes: 6000, characters: 6000 })
    expect(JSON.parse(result.content)).not.toHaveProperty("budget")
  })

  it("refuses to treat an existing file as absent", async () => {
    await expect(tool.execute({ action: "write", path: PATH, expectedHash: null, content: "Replacement" }, CONTEXT)).rejects.toThrow("Source changed")
  })

  it.each(["src/index.ts", "../outside.md", ".opencode/backlog/AGENTS.md", ".opencode/orchestrator/archive/old.md"])("rejects non-live target %s", async (path) => {
    await expect(tool.execute({ action: "write", path, expectedHash: null, content: "Wrong destination" }, CONTEXT)).rejects.toThrow("Unsupported memory path")
  })

  it("rejects another agent", async () => {
    await expect(tool.execute({ action: "read", path: PATH }, { agent: "general" })).rejects.toThrow("memory-manager")
  })

  it("rejects a symlink target", async () => {
    symlinkSync(join(directory, PATH), join(directory, ".opencode/backlog/LINK.md"))
    await expect(tool.execute({ action: "read", path: ".opencode/backlog/LINK.md" }, CONTEXT)).rejects.toThrow("Symbolic")
  })

  it("rejects a symlinked ancestor", async () => {
    mkdirSync(join(directory, "elsewhere"))
    symlinkSync(join(directory, "elsewhere"), join(directory, ".opencode/orchestrator"))
    await expect(tool.execute({ action: "write", path: ".opencode/orchestrator/learnings.md", expectedHash: null, content: "Fact" }, CONTEXT)).rejects.toThrow("Symbolic")
  })

  it("rejects a write without an expected source identity", async () => {
    await expect(tool.execute({ action: "write", path: PATH, content: "Replacement" }, CONTEXT)).rejects.toThrow("expectedHash")
  })

  it("does not clear another writer's lock", async () => {
    const lock = join(directory, `${PATH}.memory-lock`)
    writeFileSync(lock, "Other writer")
    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)).rejects.toThrow("lock")
    expect(readFileSync(lock, "utf8")).toBe("Other writer")
  })

  it("records the owning process and session before replacement", async () => {
    const actual = actualFs
    let owner: unknown
    renameSyncSpy.mockImplementation((from, to) => {
      owner = JSON.parse(readFileSync(join(directory, `${PATH}.memory-lock`), "utf8"))
      actualFs.renameSync(from, to)
    })

    await tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)

    expect(owner).toMatchObject({ pid: process.pid, sessionID: CONTEXT.sessionID, createdAt: expect.any(String) })
    expect(existsSync(join(directory, `${PATH}.memory-lock`))).toBe(false)
  })

  it("reports the lock path, owner and age with safe recovery instructions", async () => {
    const lock = join(directory, `${PATH}.memory-lock`)
    const owner = { pid: 1234, sessionID: "ses_other", createdAt: "2026-10-16T10:00:00.000Z" }
    writeFileSync(lock, JSON.stringify(owner))

    const result = tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)

    await expect(result).rejects.toThrow(lock)
    await expect(result).rejects.toThrow("ses_other")
    await expect(result).rejects.toThrow("1234")
    await expect(result).rejects.toThrow(/age \d+ms/)
    await expect(result).rejects.toThrow("Confirm")
    expect(readFileSync(lock, "utf8")).toBe(JSON.stringify(owner))
  })

  it("diagnoses legacy locks without pretending to know their owner", async () => {
    const lock = join(directory, `${PATH}.memory-lock`)
    writeFileSync(lock, "")

    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)).rejects.toThrow("owner unavailable")
    expect(existsSync(lock)).toBe(true)
  })

  it("retains the observed age when lock metadata is only partially written", async () => {
    const lock = join(directory, `${PATH}.memory-lock`)
    writeFileSync(lock, "{")

    const result = tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)

    await expect(result).rejects.toThrow(/age \d+ms/)
    await expect(result).rejects.toThrow("owner unavailable")
    expect(readFileSync(lock, "utf8")).toBe("{")
  })

  it("does not follow a symbolic link when diagnosing a lock", async () => {
    const lock = join(directory, `${PATH}.memory-lock`)
    symlinkSync(join(directory, PATH), lock)

    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)).rejects.toThrow("owner unavailable")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
  })

  it("requires a session identity before starting a write", async () => {
    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, { agent: "memory-manager" })).rejects.toThrow("session")
    expect(existsSync(join(directory, `${PATH}.memory-lock`))).toBe(false)
  })

  it("releases its lock if writing owner metadata fails", async () => {
    const actual = actualFs
    const failure = new Error("Disk full while recording lock owner")
    writeFileSyncSpy.mockImplementationOnce((file) => {
      actualFs.writeFileSync(file, "{")
      throw failure
    })

    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)).rejects.toBe(failure)

    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
    expect(existsSync(join(directory, `${PATH}.memory-lock`))).toBe(false)
    expect(closeSyncSpy).toHaveBeenCalledTimes(1)
  })

  it("leaves live content unchanged if preservation fails", async () => {
    mkdirSync(join(directory, ".opencode/orchestrator"))
    writeFileSync(join(directory, ".opencode/orchestrator/archive"), "Not a directory")
    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)).rejects.toThrow()
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
    expect(existsSync(join(directory, `${PATH}.memory-lock`))).toBe(false)
  })

  it("refuses invalid UTF-8 rather than rewriting a lossy view", async () => {
    writeFileSync(join(directory, PATH), Buffer.from([0xff, 0xfe]))
    await expect(tool.execute({ action: "read", path: PATH }, CONTEXT)).rejects.toThrow()
  })

  it("refuses empty replacements", async () => {
    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "" }, CONTEXT)).rejects.toThrow("non-empty")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
  })

  it("reports structure and hash without reading the document", async () => {
    const path = ".opencode/orchestrator/learnings.md"
    const content = "# Memory\n\n## Perf\ntext\n### Detail\n"
    mkdirSync(join(directory, ".opencode/orchestrator"), { recursive: true })
    writeFileSync(join(directory, path), content)

    const result = JSON.parse((await tool.execute({ action: "stat", path }, CONTEXT)).content)

    expect(result).toMatchObject({ hash: hash(content), exists: true, totalLines: 5 })
    expect(result).not.toHaveProperty("content")
    expect(result.headings).toEqual([
      { level: 1, title: "Memory", line: 1 },
      { level: 2, title: "Perf", line: 3 },
      { level: 3, title: "Detail", line: 5 },
    ])
  })

  it.each(["LF", "CRLF"])("ignores fenced code and preserves literal hashes in headings: %s", async (lineEnding) => {
    const path = ".opencode/orchestrator/learnings.md"
    const newline = lineEnding === "CRLF" ? "\r\n" : "\n"
    const content = ["# Top", "", "```sh", "# shell comment", "```", "", "## C#", "## Closing ##"].join(newline) + newline
    mkdirSync(join(directory, ".opencode/orchestrator"), { recursive: true })
    writeFileSync(join(directory, path), content)

    const result = JSON.parse((await tool.execute({ action: "stat", path }, CONTEXT)).content)

    expect(result.headings).toEqual([
      { level: 1, title: "Top", line: 1 },
      { level: 2, title: "C#", line: 7 },
      { level: 2, title: "Closing", line: 8 },
    ])
  })

  it("ignores fenced code contained in list items", async () => {
    const path = ".opencode/orchestrator/learnings.md"
    const content = "# Top\n- ```sh\n  # shell comment\n  ```\n## Real\n"
    mkdirSync(join(directory, ".opencode/orchestrator"), { recursive: true })
    writeFileSync(join(directory, path), content)

    const result = JSON.parse((await tool.execute({ action: "stat", path }, CONTEXT)).content)

    expect(result.headings).toEqual([
      { level: 1, title: "Top", line: 1 },
      { level: 2, title: "Real", line: 5 },
    ])
  })

  it("reports an absent memory file without inventing content", async () => {
    const result = JSON.parse((await tool.execute({ action: "stat", path: ".opencode/orchestrator/learnings.md" }, CONTEXT)).content)

    expect(result).toMatchObject({ hash: null, exists: false, totalLines: 0, headings: [] })
  })

  it("reads a bounded line range with its hash and continuation", async () => {
    const path = ".opencode/backlog/RANGE.md"
    const content = "one\ntwo\nthree\n"
    writeFileSync(join(directory, path), content)

    const result = JSON.parse((await tool.execute({ action: "read", path, offset: 2, limit: 1 }, CONTEXT)).content)

    expect(result).toMatchObject({
      hash: hash(content), content: "two\n", startLine: 2, endLine: 2, totalLines: 3, hasMore: true, nextOffset: 3,
    })
  })

  it("caps a large read by complete lines and reports where to continue", async () => {
    const path = ".opencode/backlog/LARGE.md"
    const content = Array.from({ length: 8000 }, (_, index) => `line ${index} ${"x".repeat(80)}`).join("\n") + "\n"
    writeFileSync(join(directory, path), content)

    const result = JSON.parse((await tool.execute({ action: "read", path }, CONTEXT)).content)

    expect(result.hasMore).toBe(true)
    expect(result.endLine).toBeLessThan(8000)
    expect(result.content.length).toBeLessThanOrEqual(20_000)
    expect(result.nextOffset).toBe(result.endLine + 1)
  })

  it("rejects an invalid read offset", async () => {
    await expect(tool.execute({ action: "read", path: PATH, offset: 0 }, CONTEXT)).rejects.toThrow("positive integer")
  })

  it("patches a unique passage and archives the complete original", async () => {
    const result = JSON.parse((await tool.execute({
      action: "patch", path: PATH, expectedHash: hash("Original evidence\n"), oldText: "Original", newText: "Updated",
    }, CONTEXT)).content)

    expect(result).toMatchObject({
      changed: true, operation: "patch", hash: hash("Updated evidence\n"), characterDelta: -1, lineDelta: 0,
    })
    expect(readFileSync(result.archive, "utf8")).toBe("Original evidence\n")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Updated evidence\n")
  })

  it("treats replacement text literally", async () => {
    const result = JSON.parse((await tool.execute({
      action: "patch", path: PATH, expectedHash: hash("Original evidence\n"), oldText: "Original", newText: "$& $1",
    }, CONTEXT)).content)

    expect(result.changed).toBe(true)
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("$& $1 evidence\n")
  })

  it("rejects a patch whose target is not unique", async () => {
    writeFileSync(join(directory, PATH), "same same\n")

    await expect(tool.execute({
      action: "patch", path: PATH, expectedHash: hash("same same\n"), oldText: "same", newText: "other",
    }, CONTEXT)).rejects.toThrow("not unique")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("same same\n")
  })

  it("rejects overlapping patch targets without modifying the file", async () => {
    writeFileSync(join(directory, PATH), "ababa\n")

    await expect(tool.execute({
      action: "patch", path: PATH, expectedHash: hash("ababa\n"), oldText: "aba", newText: "X",
    }, CONTEXT)).rejects.toThrow("not unique")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("ababa\n")
    expect(readdirSync(join(directory, ".opencode"))).toEqual(["backlog"])
  })

  it("rejects a patch whose target is absent", async () => {
    await expect(tool.execute({
      action: "patch", path: PATH, expectedHash: hash("Original evidence\n"), oldText: "absent", newText: "other",
    }, CONTEXT)).rejects.toThrow("not found")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
  })

  it("rejects a stale patch without replacing the file", async () => {
    writeFileSync(join(directory, PATH), "Concurrent update\n")

    await expect(tool.execute({
      action: "patch", path: PATH, expectedHash: hash("Original evidence\n"), oldText: "Original", newText: "Updated",
    }, CONTEXT)).rejects.toThrow("Source changed")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Concurrent update\n")
  })

  it("reports an unchanged patch without archiving", async () => {
    const result = JSON.parse((await tool.execute({
      action: "patch", path: PATH, expectedHash: hash("Original evidence\n"), oldText: "Original", newText: "Original",
    }, CONTEXT)).content)

    expect(result.changed).toBe(false)
    expect(readdirSync(join(directory, ".opencode"))).toEqual(["backlog"])
  })

  it("rejects a patch that would empty the memory file", async () => {
    await expect(tool.execute({
      action: "patch", path: PATH, expectedHash: hash("Original evidence\n"), oldText: "Original evidence\n", newText: "",
    }, CONTEXT)).rejects.toThrow("empty the memory file")
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
  })

  it("requires an existing target for a patch", async () => {
    await expect(tool.execute({
      action: "patch", path: ".opencode/orchestrator/learnings.md", expectedHash: null, oldText: "x", newText: "y",
    }, CONTEXT)).rejects.toThrow("Patch requires an existing file")
  })

  it("requires a fresh hash for a patch", async () => {
    await expect(tool.execute({ action: "patch", path: PATH, oldText: "Original", newText: "Updated" }, CONTEXT)).rejects.toThrow("expectedHash")
  })

  it.each([false, true])("releases the lock after partial write failure, even when temporary removal fails: %s", async (cleanupFails) => {
    const actual = actualFs
    const writeError = new Error("Disk full during temporary write")
    const cleanupError = new Error("Cannot remove temporary")
    writeFileSyncSpy.mockImplementation((file, data, options) => {
      if (typeof file === "number" && Buffer.isBuffer(data)) {
        actualFs.writeFileSync(file, "partial")
        throw writeError
      }
      actualFs.writeFileSync(file, data, options)
    })
    if (cleanupFails) unlinkSyncSpy.mockImplementation((path) => {
      if (String(path).endsWith(".tmp")) throw cleanupError
      actual.unlinkSync(path)
    })
    const result = tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)
    if (cleanupFails) {
      await expect(result).rejects.toMatchObject({ cause: writeError, errors: [writeError, cleanupError] })
    } else {
      await expect(result).rejects.toBe(writeError)
    }
    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
    expect(existsSync(join(directory, `${PATH}.memory-lock`))).toBe(false)
    expect(closeSyncSpy).toHaveBeenCalledTimes(2)
    expect(readdirSync(join(directory, ".opencode/backlog")).filter((name) => name.endsWith(".tmp"))).toHaveLength(cleanupFails ? 1 : 0)
  })
})
