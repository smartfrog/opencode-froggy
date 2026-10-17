import { createHash, randomUUID } from "node:crypto"
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { asRecord } from "../record"

const hash = (content: Buffer | null) => content === null ? null : createHash("sha256").update(content).digest("hex")
const MEMORY_TARGET_CHARACTERS = 5000
const READ_MAX_CHARACTERS = 20_000

const codePoints = (text: string) => Array.from(text).length

function lineCount(text: string): number {
  if (text === "") return 0
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}

function memoryUsage(content: Buffer | null, projectKnowledge: boolean) {
  const characters = codePoints(content?.toString("utf8") ?? "")
  const size = {
    bytes: content?.length ?? 0,
    characters,
    characterUnit: "unicode-code-points",
  }
  if (!projectKnowledge) return size
  return {
    ...size,
    budget: {
      targetCharacters: MEMORY_TARGET_CHARACTERS,
      remainingCharacters: Math.max(0, MEMORY_TARGET_CHARACTERS - characters),
      excessCharacters: Math.max(0, characters - MEMORY_TARGET_CHARACTERS),
      hardLimit: false,
    },
  }
}

function stat(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (asRecord(error).code === "ENOENT") return undefined
    throw error
  }
}

function assertNoLinks(root: string, path: string): void {
  let current = root
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part)
    if (stat(current)?.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${current}`)
  }
}

function readSource(path: string): Buffer | null {
  const info = stat(path)
  if (!info) return null
  if (!info.isFile() || info.nlink !== 1) throw new Error("Memory target must be a regular file with a single hard link")
  const content = readFileSync(path)
  new TextDecoder("utf-8", { fatal: true }).decode(content)
  return content
}

function describeLock(path: string): string {
  let age = "age unavailable"
  try {
    const info = stat(path)
    if (!info) return "lock disappeared; owner unavailable"
    age = `age ${Math.max(0, Math.floor(Date.now() - info.mtimeMs))}ms`
    if (!info.isFile() || info.nlink !== 1 || info.size > 4096) return `${age}; owner unavailable (unsafe lock metadata)`
    const text = readFileSync(path, "utf8")
    if (!text.trim()) return `${age}; owner unavailable (legacy or interrupted lock)`
    const owner = asRecord(JSON.parse(text))
    if (!Number.isSafeInteger(owner.pid) || typeof owner.sessionID !== "string" ||
        typeof owner.createdAt !== "string" || !Number.isFinite(Date.parse(owner.createdAt))) {
      return `${age}; owner unavailable (invalid lock metadata)`
    }
    return `${age}; PID ${owner.pid}, session ${owner.sessionID}, created ${owner.createdAt}`
  } catch (error) {
    return `${age}; owner unavailable; lock inspection failed: ${String(error)}`
  }
}

function headings(text: string) {
  const result: Array<{ level: number; title: string; line: number }> = []
  const lines = text.split("\n")
  let fence: { marker: string; length: number } | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].endsWith("\r") ? lines[index].slice(0, -1) : lines[index]
    if (fence !== null) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null
      continue
    }
    const open = /^\s{0,3}(?:(?:[-+*]|\d{1,9}[.)])\s+)?(`{3,}|~{3,})(.*)$/.exec(line)
    if (open) {
      fence = { marker: open[1][0], length: open[1].length }
      continue
    }
    const match = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*$/.exec(line)
    if (!match) continue
    const title = (match[2] ?? "").replace(/\s+#+\s*$/, "").trim()
    if (title) result.push({ level: match[1].length, title, line: index + 1 })
  }
  return result
}

function renderLines(lines: string[], end: number, totalLines: number, trailingNewline: boolean): string {
  if (lines.length === 0) return ""
  return lines.join("\n") + (end < totalLines || trailingNewline ? "\n" : "")
}

function saveMemoryFile(
  root: string,
  path: string,
  before: Buffer | null,
  sourceHash: string | null,
  next: Buffer,
  sessionID: string,
  projectKnowledge: boolean,
  extra: Record<string, unknown>,
): string {
  const beforeText = before?.toString("utf8") ?? ""
  const afterText = next.toString("utf8")
  const changes = {
    previousCharacters: codePoints(beforeText),
    characterDelta: codePoints(afterText) - codePoints(beforeText),
    previousLines: lineCount(beforeText),
    lineDelta: lineCount(afterText) - lineCount(beforeText),
    ...extra,
  }
  if (before?.equals(next)) {
    return JSON.stringify({ path, hash: sourceHash, changed: false, ...memoryUsage(before, projectKnowledge), ...changes })
  }

  mkdirSync(dirname(path), { recursive: true })
  assertNoLinks(root, path)
  const lock = `${path}.memory-lock`
  let descriptor: number
  try {
    descriptor = openSync(lock, "wx", 0o600)
  } catch (error) {
    const detail = asRecord(error).code === "EEXIST"
      ? `${describeLock(lock)}. Confirm the owning session/tool has stopped and inspect the live file and archives before the coordinator removes only this lock if abandoned. Never remove a lock based on age alone.`
      : `Check filesystem access: ${String(error)}`
    throw new Error(`Cannot acquire memory file lock at ${lock}; ${detail}`, { cause: error })
  }
  const temporary = join(dirname(path), `.memory-${randomUUID()}.tmp`)
  let temporaryCreated = false
  let temporaryDescriptor: number | undefined
  let failure: unknown
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, sessionID, createdAt: new Date().toISOString() }))
    const current = readSource(path)
    if (hash(current) !== sourceHash) throw new Error("Source changed while acquiring write ownership")
    let archive: string | null = null
    if (before !== null) {
      const archiveDir = join(root, ".opencode/orchestrator/archive")
      assertNoLinks(root, archiveDir)
      mkdirSync(archiveDir, { recursive: true })
      assertNoLinks(root, archiveDir)
      archive = join(archiveDir, `memory-${basename(path, ".md")}-${randomUUID()}.md`)
      writeFileSync(archive, before, { flag: "wx", mode: 0o600 })
      if (!readFileSync(archive).equals(before)) throw new Error("Original archive verification failed; live file not replaced")
    }
    temporaryDescriptor = openSync(temporary, "wx", 0o600)
    temporaryCreated = true
    writeFileSync(temporaryDescriptor, next)
    closeSync(temporaryDescriptor)
    temporaryDescriptor = undefined
    assertNoLinks(root, path)
    const latest = readSource(path)
    if (hash(latest) !== sourceHash) throw new Error("Source changed before replacement; live file not replaced")
    renameSync(temporary, path)
    temporaryCreated = false
    const saved = readFileSync(path)
    if (!saved.equals(next)) throw new Error("Memory file was replaced but saved-content verification failed; inspect before retrying")
    return JSON.stringify({
      path,
      changed: true,
      previousHash: sourceHash,
      hash: hash(saved),
      archive,
      archiveHash: archive ? sourceHash : null,
      ...memoryUsage(saved, projectKnowledge),
      ...changes,
    })
  } catch (error) {
    failure = error
    throw error
  } finally {
    const errors: unknown[] = []
    const cleanup = [
      () => { if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor) },
      () => { if (temporaryCreated) unlinkSync(temporary) },
      () => closeSync(descriptor),
      () => unlinkSync(lock),
    ]
    for (const operation of cleanup) {
      try {
        operation()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) {
      throw new AggregateError(failure === undefined ? errors : [failure, ...errors], "Memory save cleanup incomplete; inspect files and lock before retrying", { cause: failure })
    }
  }
}

export function createMemoryFileTool(directory: string) {
  const root = realpathSync(directory)

  return {
    name: "memory-file",
    options: { codemode: false },
    description: "For memory-manager only: inspect structure, read canonical notes/tickets in bounded ranges, patch a unique passage, or save with verified original archival. Project knowledge reports a soft character budget, never a hard limit. No file deletion or arbitrary editing.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["stat", "read", "write", "patch"] },
        path: { type: "string", minLength: 1, description: "Canonical project's .opencode/backlog/<id>.md or .opencode/orchestrator/learnings.md; other locations require the coordinator, not this tool" },
        expectedHash: { type: ["string", "null"], description: "Hash returned by stat or read; required for write and patch. Null only for an absent file when writing." },
        content: { type: "string", minLength: 1, description: "Complete replacement content for write" },
        offset: { type: "integer", minimum: 1, description: "First 1-based line for read; defaults to 1" },
        limit: { type: "integer", minimum: 1, description: "Maximum lines for read; bounded by the read character limit" },
        oldText: { type: "string", minLength: 1, description: "Exact text to replace; must occur once in the current file" },
        newText: { type: "string", description: "Replacement text for patch; empty removes the matched text" },
      },
      required: ["action", "path"],
      additionalProperties: false,
    },
    async execute(input: unknown, context: unknown) {
      if (asRecord(context).agent !== "memory-manager") throw new Error("Only memory-manager may use memory-file")
      const args = asRecord(input)
      if (typeof args.path !== "string" || !args.path.trim()) throw new Error("A memory path is required")
      const path = resolve(root, args.path)
      const local = relative(root, path).split(sep).join("/")
      const projectKnowledge = local === ".opencode/orchestrator/learnings.md"
      const backlogTicket = /^\.opencode\/backlog\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(local)
      const instructionFile = /^(AGENTS|SKILL)\.md$/i.test(basename(path))
      if ((!projectKnowledge && !backlogTicket) || instructionFile) {
        throw new Error(`Unsupported memory path: use ${join(root, ".opencode/backlog/<id>.md")} or ${join(root, ".opencode/orchestrator/learnings.md")}; other authoritative locations remain coordinator-written`)
      }
      assertNoLinks(root, path)

      if (args.action === "stat") {
        const source = readSource(path)
        const text = source?.toString("utf8") ?? ""
        return { content: JSON.stringify({
          path,
          hash: hash(source),
          exists: source !== null,
          totalLines: lineCount(text),
          headings: headings(text),
          ...memoryUsage(source, projectKnowledge),
        }) }
      }

      if (args.action === "read") {
        const source = readSource(path)
        const text = source?.toString("utf8") ?? null
        const totalLines = text === null ? 0 : lineCount(text)
        const offset = args.offset === undefined ? 1 : args.offset
        const limit = args.limit === undefined ? Math.max(totalLines, 1) : args.limit
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 1) throw new Error("offset must be a positive integer")
        if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer")
        if (totalLines > 0 && offset > totalLines) throw new Error(`offset ${offset} exceeds ${totalLines} lines`)
        const lines = text === null ? [] : text.split("\n")
        const trailingNewline = text?.endsWith("\n") ?? false
        if (text !== null && trailingNewline) lines.pop()
        const startIndex = offset - 1
        const maxLines = Math.min(limit, Math.max(0, totalLines - startIndex))
        let endIndex = startIndex
        let characters = 0
        while (endIndex < startIndex + maxLines) {
          const lineNumber = endIndex + 1
          const separator = lineNumber < totalLines || trailingNewline ? 1 : 0
          const addition = codePoints(lines[endIndex]) + separator
          if (endIndex > startIndex && characters + addition > READ_MAX_CHARACTERS) break
          characters += addition
          endIndex += 1
        }
        const selected = lines.slice(startIndex, endIndex)
        const end = endIndex
        const content = renderLines(selected, end, totalLines, trailingNewline)
        if (codePoints(content) > READ_MAX_CHARACTERS) {
          throw new Error(`A memory line exceeds the ${READ_MAX_CHARACTERS}-character read limit; use a shorter range or patch a known passage`)
        }
        const hasMore = end < totalLines
        return { content: JSON.stringify({
          path,
          hash: hash(source),
          content: text === null ? null : content,
          startLine: offset,
          endLine: end,
          totalLines,
          hasMore,
          nextOffset: hasMore ? end + 1 : null,
          ...memoryUsage(source, projectKnowledge),
        }) }
      }

      if (args.action !== "write" && args.action !== "patch") throw new Error("action must be stat, read, write or patch")
      if (args.expectedHash !== null && (typeof args.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(args.expectedHash))) {
        throw new Error("Write and patch require expectedHash from a fresh stat or read")
      }
      if (args.action === "patch" && args.expectedHash === null) throw new Error("Patch requires an existing file and expectedHash from a fresh stat or read")
      const sessionID = asRecord(context).sessionID
      if (typeof sessionID !== "string" || !sessionID.trim()) throw new Error("A current session is required for memory writes")

      const before = readSource(path)
      const sourceHash = hash(before)
      if (sourceHash !== args.expectedHash) throw new Error("Source changed; read and reconcile before writing")

      let next: Buffer
      let extra: Record<string, unknown>
      if (args.action === "write") {
        if (typeof args.content !== "string" || !args.content.trim()) throw new Error("Write requires non-empty content")
        next = Buffer.from(args.content)
        extra = { operation: "write" }
      } else {
        if (before === null) throw new Error("Patch target does not exist")
        const oldText = args.oldText
        const newText = args.newText
        if (typeof oldText !== "string" || !oldText) throw new Error("Patch requires non-empty oldText")
        if (typeof newText !== "string") throw new Error("Patch requires newText")
        const beforeText = before.toString("utf8")
        const first = beforeText.indexOf(oldText)
        if (first === -1) throw new Error("Patch oldText not found in the current source")
        if (beforeText.indexOf(oldText, first + 1) !== -1) throw new Error("Patch oldText is not unique; include more context")
        const nextText = beforeText.slice(0, first) + newText + beforeText.slice(first + oldText.length)
        if (!nextText.trim()) throw new Error("Patch would empty the memory file; use write with curated content")
        next = Buffer.from(nextText)
        extra = { operation: "patch", oldTextCharacters: codePoints(oldText), newTextCharacters: codePoints(newText) }
      }

      return { content: saveMemoryFile(root, path, before, sourceHash, next, sessionID, projectKnowledge, extra) }
    },
  }
}
