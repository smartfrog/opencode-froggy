import { createHash, randomUUID } from "node:crypto"
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { asRecord } from "../record"

const hash = (content: Buffer | null) => content === null ? null : createHash("sha256").update(content).digest("hex")
const MEMORY_TARGET_CHARACTERS = 5000

function memoryUsage(content: Buffer | null, projectKnowledge: boolean) {
  const characters = Array.from(content?.toString("utf8") ?? "").length
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

export function createMemoryFileTool(directory: string) {
  const root = realpathSync(directory)

  return {
    name: "memory-file",
    options: { codemode: false },
    description: "For memory-manager only: read canonical notes/tickets with hash and usage, or save with verified original archival. Project knowledge reports a soft character budget, never a hard limit. No deletion or arbitrary editing.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write"] },
        path: { type: "string", minLength: 1, description: "Canonical project's .opencode/backlog/<id>.md or .opencode/orchestrator/learnings.md; other locations require the coordinator, not this tool" },
        expectedHash: { type: ["string", "null"], description: "Hash returned by read, or null only for an absent file; required for write" },
        content: { type: "string", minLength: 1 },
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
      if (args.action === "read") {
        const source = readSource(path)
        return { content: JSON.stringify({ path, hash: hash(source), content: source === null ? null : source.toString("utf8"), ...memoryUsage(source, projectKnowledge) }) }
      }
      if (args.action !== "write") throw new Error("action must be read or write")
      if (args.expectedHash !== null && (typeof args.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(args.expectedHash))) throw new Error("Write requires expectedHash from a fresh memory-file read")
      if (typeof args.content !== "string" || !args.content.trim()) throw new Error("Write requires non-empty content")
      const sessionID = asRecord(context).sessionID
      if (typeof sessionID !== "string" || !sessionID.trim()) throw new Error("A current session is required for memory writes")

      const before = readSource(path)
      const sourceHash = hash(before)
      if (sourceHash !== args.expectedHash) throw new Error("Source changed; read and reconcile before writing")
      const next = Buffer.from(args.content)
      if (before?.equals(next)) return { content: JSON.stringify({ path, hash: sourceHash, changed: false, ...memoryUsage(before, projectKnowledge) }) }

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
        return { content: JSON.stringify({ path, changed: true, previousHash: sourceHash, hash: hash(saved), archive, archiveHash: archive ? sourceHash : null, ...memoryUsage(saved, projectKnowledge) }) }
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
    },
  }
}
