import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { ModuleKind, ScriptTarget, transpileModule } from "typescript"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

describe("orchestration recovery across processes", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir(), "froggy-recovery-"))
    writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "commonjs" }))
    for (const name of ["record", "logger", "session-children", "orchestrator-diagnostics", "orchestrator-loop", "tools/memory-file", "test-fixtures/orchestrator-recovery"]) {
      const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8")
      const target = join(directory, `${name}.js`)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, transpileModule(source, {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText)
    }
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  function run(stage: string) {
    return JSON.parse(execFileSync(process.execPath, [join(directory, "test-fixtures/orchestrator-recovery.js"), stage], {
      cwd: directory, encoding: "utf8", timeout: 10_000,
    })) as Record<string, unknown>
  }

  it("recovers assignment and cadence from disk with an empty child registry in a fresh process", () => {
    const prepared = run("prepare")

    const recovered = run("recover")

    expect(prepared.childCount).toBe(1)
    expect(recovered.pid).not.toBe(prepared.pid)
    expect(recovered.childCount).toBe(0)
    expect(recovered.assignment).toMatchObject({
      workerSessionID: "ses_fixture_worker",
      nextAction: "Complete the fixture investigation",
      workspace: join(directory, "worker"),
    })
    expect(recovered.sessionAndWorkspaceVerified).toBe(true)
    expect(recovered.hash).toBe(prepared.hash)
    expect(recovered.revision).toBe(prepared.revision)
    expect(recovered.delay).toBe(1000)
    expect(recovered.admitted).toBe(1)
    expect(recovered.woken).toBe(1)
  })

  it("preserves and diagnoses an owned lock after its writing process exits before replacement", () => {
    run("prepare")
    expect(() => run("crash")).toThrow(expect.objectContaining({ status: 77 }))

    const inspected = run("inspect-lock")

    expect(inspected.error).toContain("ses_fixture_crash")
    expect(inspected.error).toMatch(/age \d+ms/)
    expect(inspected.error).toContain("Confirm")
    expect(inspected.lockRetained).toBe(true)
    expect(inspected.originalPreserved).toBe(true)
  })
})
