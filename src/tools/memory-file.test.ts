import { createHash } from "node:crypto"
import { closeSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMemoryFileTool } from "./memory-file"

const CONTEXT = { agent: "memory-manager", sessionID: "ses_memory" }
const PATH = ".opencode/backlog/TASK.md"
const hash = (text: string) => createHash("sha256").update(text).digest("hex")

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), unlinkSync: vi.fn(actual.unlinkSync), closeSync: vi.fn(actual.closeSync), renameSync: vi.fn(actual.renameSync) }
})

describe("guarded memory files", () => {
  let directory: string
  let tool: ReturnType<typeof createMemoryFileTool>

  beforeEach(() => {
    vi.clearAllMocks()
    directory = mkdtempSync(join(tmpdir(), "froggy-memory-"))
    mkdirSync(join(directory, ".opencode/backlog"), { recursive: true })
    writeFileSync(join(directory, PATH), "Original evidence\n")
    tool = createMemoryFileTool(directory)
  })

  afterEach(() => {
    vi.mocked(writeFileSync).mockRestore()
    vi.mocked(unlinkSync).mockRestore()
    vi.mocked(renameSync).mockRestore()
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
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
    let owner: unknown
    vi.mocked(renameSync).mockImplementation((from, to) => {
      owner = JSON.parse(readFileSync(join(directory, `${PATH}.memory-lock`), "utf8"))
      actual.renameSync(from, to)
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
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
    const failure = new Error("Disk full while recording lock owner")
    vi.mocked(writeFileSync).mockImplementationOnce((file) => {
      actual.writeFileSync(file, "{")
      throw failure
    })

    await expect(tool.execute({ action: "write", path: PATH, expectedHash: hash("Original evidence\n"), content: "Replacement" }, CONTEXT)).rejects.toBe(failure)

    expect(readFileSync(join(directory, PATH), "utf8")).toBe("Original evidence\n")
    expect(existsSync(join(directory, `${PATH}.memory-lock`))).toBe(false)
    expect(vi.mocked(closeSync)).toHaveBeenCalledOnce()
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

  it.each([false, true])("releases the lock after partial write failure, even when temporary removal fails: %s", async (cleanupFails) => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
    const writeError = new Error("Disk full during temporary write")
    const cleanupError = new Error("Cannot remove temporary")
    vi.mocked(writeFileSync).mockImplementation((file, data, options) => {
      if (typeof file === "number" && Buffer.isBuffer(data)) {
        actual.writeFileSync(file, "partial")
        throw writeError
      }
      actual.writeFileSync(file, data, options)
    })
    if (cleanupFails) vi.mocked(unlinkSync).mockImplementation((path) => {
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
    expect(vi.mocked(closeSync)).toHaveBeenCalledTimes(2)
    expect(readdirSync(join(directory, ".opencode/backlog")).filter((name) => name.endsWith(".tmp"))).toHaveLength(cleanupFails ? 1 : 0)
  })
})
