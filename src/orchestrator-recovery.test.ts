import { execFileSync } from "node:child_process"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "./test-fixtures/temporary-directory"

const RECOVERY_FIXTURE = fileURLToPath(new URL("./test-fixtures/orchestrator-recovery.ts", import.meta.url))

describe("orchestration recovery across processes", () => {
  let directory: string

  beforeEach(() => {
    directory = createTemporaryDirectory("froggy-recovery-")
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  function run(stage: string) {
    return JSON.parse(execFileSync(process.execPath, [RECOVERY_FIXTURE, stage], {
      cwd: directory, encoding: "utf8", timeout: 10_000,
    })) as Record<string, unknown>
  }

  it("recovers assignment and cadence from disk in a fresh process", () => {
    const prepared = run("prepare")

    const recovered = run("recover")

    expect(recovered.pid).not.toBe(prepared.pid)
    expect(recovered.assignment).toMatchObject({
      workerSessionID: "ses_fixture_worker",
      nextAction: "Complete the fixture investigation",
      workspace: join(directory, "worker"),
    })
    expect(recovered.sessionAndWorkspaceVerified).toBe(true)
    expect(recovered.taskVersion).toBe(prepared.taskVersion)
    expect(recovered.revision).toBe(prepared.revision)
    expect(recovered.delay).toBe(1000)
    expect(recovered.admitted).toBe(1)
    expect(recovered.woken).toBe(1)
  })

  it("rolls back an interrupted SQLite write and allows subsequent updates", () => {
    run("prepare")
    expect(() => run("crash")).toThrow(expect.objectContaining({ status: 77 }))

    const inspected = run("inspect-rollback")

    expect(inspected.writesResumed).toBe(true)
    expect(inspected.originalPreserved).toBe(true)
  })
})
