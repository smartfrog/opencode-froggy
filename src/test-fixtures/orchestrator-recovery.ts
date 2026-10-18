import fs from "node:fs"
import { join } from "node:path"
import { createOrchestratorLoop, type LoopSessionClient, type LoopStorage } from "../orchestrator-loop"
import { asRecord } from "../record"
import { ChildSessionTracker } from "../session-children"
import { openProjectMemory } from "../memory/project"
import { openSqlite } from "../memory/sqlite"
import { createTaskBoardTool } from "../tools/task-board"

type StoredValues = Record<string, Parameters<LoopStorage["set"]>[1]>

function readJsonObject(path: string): StoredValues {
  const value: unknown = JSON.parse(fs.readFileSync(path, "utf8"))
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Fixture JSON object required: ${path}`)
  return value as StoredValues
}

const directory = process.cwd()
const context = { agent: "memory-manager", sessionID: "ses_fixture_manager" }
const memory = createTaskBoardTool(directory)
const tracker = new ChildSessionTracker()
const storageFile = join(directory, "storage.json")
const sessionsFile = join(directory, "sessions.json")
const readStorage = (): StoredValues => fs.existsSync(storageFile) ? readJsonObject(storageFile) : {}
const storage: LoopStorage = {
  get: async (key) => readStorage()[key],
  set: async (key, value) => fs.writeFileSync(storageFile, JSON.stringify({ ...readStorage(), [key]: value })),
  remove: async (key) => {
    const saved = readStorage()
    delete saved[key]
    fs.writeFileSync(storageFile, JSON.stringify(saved))
  },
  scan: async ({ prefix }) => ({ entries: Object.entries(readStorage()).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) }),
}
const pending: Awaited<ReturnType<LoopSessionClient["inbox"]["list"]>> = []
let admitted = 0
let woken = 0
const session = {
  get: async ({ sessionID }) => {
    const found = asRecord(readJsonObject(sessionsFile)[sessionID])
    if (found.id !== sessionID || typeof found.agent !== "string") throw new Error(`Fixture session missing or invalid: ${sessionID}`)
    return { id: sessionID, agent: found.agent, location: found.location }
  },
  inbox: {
    list: async () => pending,
    cancel: async ({ inboxID }) => {
      const index = pending.findIndex((item) => item.id === inboxID)
      if (index !== -1) pending.splice(index, 1)
    },
  },
  synthetic: async (input) => {
    if (!input.id) {
      admitted++
      pending.push({ id: "msg_fixture", type: "synthetic", payload: input })
    }
    if (input.resume) woken++
    return { id: input.id ?? "msg_fixture" }
  },
} satisfies LoopSessionClient

function readSchedule() {
  const config = asRecord(readStorage()["orchestrator-loop/ses_fixture_parent"])
  if (typeof config.startedAt !== "number" || !Number.isFinite(config.startedAt) || typeof config.revision !== "string") {
    throw new Error("Fixture schedule is missing or invalid")
  }
  return { startedAt: config.startedAt, revision: config.revision }
}

async function main() {
  const stage = process.argv[2]
  if (stage === "prepare") {
    const workspace = join(directory, "worker")
    fs.mkdirSync(workspace)
    fs.writeFileSync(sessionsFile, JSON.stringify({
      ses_fixture_parent: { id: "ses_fixture_parent", agent: "orchestrator" },
      ses_fixture_worker: { id: "ses_fixture_worker", agent: "general", location: { directory: workspace } },
    }))
    tracker.trackChild({ id: "ses_fixture_worker", parentID: "ses_fixture_parent", created: Date.now(), updated: Date.now() })
    const assignment = { id: "FIXTURE", status: "in-progress", workerSessionID: "ses_fixture_worker", workspace, nextAction: "Complete the fixture investigation" }
    const receipt = asRecord(JSON.parse((await memory.execute({ action: "save", id: "FIXTURE", title: "Recover assignment", status: "in-progress", description: JSON.stringify(assignment) }, context)).content))
    if (typeof receipt.version !== "number") throw new Error("Fixture save receipt is missing its version")
    const loop = createOrchestratorLoop({ directory, storage, session })
    await loop.start("ses_fixture_parent", { objective: "Recover the fixture assignment", intervalMinutes: 1 })
    return { pid: process.pid, taskVersion: receipt.version, childCount: tracker.listChildren("ses_fixture_parent").length, revision: readSchedule().revision }
  }
  const { store } = openProjectMemory(directory, { readonly: true })
  let source
  try {
    source = store.getTask("FIXTURE")
  } finally {
    store.close()
  }
  if (!source) throw new Error("Fixture memory source is missing")
  if (stage === "crash") {
    const database = openSqlite(join(directory, ".opencode/memory/memory.db"))
    database.exec("BEGIN IMMEDIATE")
    database.prepare("UPDATE tasks SET description = ? WHERE id = ?").run("Interrupted replacement", "FIXTURE")
    process.exit(77)
  }
  if (stage === "inspect-rollback") {
    const receipt = asRecord(JSON.parse((await memory.execute({ action: "save", id: "FIXTURE", expectedVersion: source.version, status: "review" }, context)).content))
    return { originalPreserved: source.description.includes("Complete the fixture investigation"), writesResumed: receipt.version === source.version + 1 }
  }
  if (stage !== "recover") throw new Error(`Unknown fixture stage: ${stage}`)
  const assignment = asRecord(JSON.parse(source.description))
  if (typeof assignment.workerSessionID !== "string" || typeof assignment.workspace !== "string" || typeof assignment.nextAction !== "string") {
    throw new Error("Fixture assignment is missing or invalid")
  }
  const worker = await session.get({ sessionID: assignment.workerSessionID })
  const workerLocation = asRecord(worker.location)
  const config = readSchedule()
  let now = config.startedAt + 59_000
  Date.now = () => now
  const timers: { callback: () => void; delay: number }[] = []
  const nativeSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = new Proxy(nativeSetTimeout, {
    apply(_target, _receiver, [callback, delay = 0, ...args]: unknown[]): ReturnType<typeof nativeSetTimeout> {
      if (typeof callback !== "function" || typeof delay !== "number") throw new Error("Invalid fixture timer arguments")
      timers.push({ callback: () => callback(...args), delay })
      // A cancelled native handle keeps the timer contract without scheduling real work.
      const timer = nativeSetTimeout(() => {}, 2_147_483_647)
      clearTimeout(timer)
      return timer
    },
  })
  const loop = createOrchestratorLoop({ directory, storage, session })
  await loop.restore()
  const delay = timers[0].delay
  now += delay
  timers[0].callback()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await loop.close()
  return { pid: process.pid, taskVersion: source.version, assignment, childCount: tracker.listChildren("ses_fixture_parent").length, sessionAndWorkspaceVerified: worker.agent === "general" && workerLocation.directory === assignment.workspace && fs.statSync(assignment.workspace).isDirectory(), delay, revision: config.revision, admitted, woken }
}

main().then((result) => process.stdout.write(JSON.stringify(result))).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
