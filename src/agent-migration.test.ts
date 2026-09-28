import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { migrateAgentCopies } from "./agent-migration"

describe("legacy agent copies", () => {
  let root: string
  const original = "---\ndescription: Review\nmode: subagent\n---\nInspect changes\n"
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-migration-"))
    mkdirSync(join(root, "bundled"))
    mkdirSync(join(root, "agents"))
    writeFileSync(join(root, "bundled/reviewer.md"), original)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("archives a matching copy including its old promoted mode", () => {
    const promoted = original.replace("subagent", "primary")
    writeFileSync(join(root, "agents/reviewer.md"), promoted)
    const result = migrateAgentCopies(join(root, "bundled"), join(root, "agents"))
    expect(existsSync(join(root, "agents/reviewer.md"))).toBe(false)
    expect(readFileSync(result.backups[0], "utf8")).toBe(promoted)
  })

  it("leaves a customized copy active and reports its path", () => {
    const path = join(root, "agents/reviewer.md")
    writeFileSync(path, original + "Custom instructions\n")
    const result = migrateAgentCopies(join(root, "bundled"), join(root, "agents"))
    expect(result.conflicts).toEqual([path])
    expect(readFileSync(path, "utf8")).toContain("Custom instructions")
  })

})
