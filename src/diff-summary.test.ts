import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { diffSummary } from "./diff-summary"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { exec } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(exec)

async function git(cwd: string, command: string): Promise<string> {
  const { stdout } = await execAsync(`git ${command}`, { cwd })
  return stdout
}

describe("diff-summary", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "diff-summary-test-"))
    await git(tempDir, "init")
    await git(tempDir, "config user.email 'test@test.com'")
    await git(tempDir, "config user.name 'Test'")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe("working-tree mode", () => {
    it("should return status overview when no changes", async () => {
      await writeFile(join(tempDir, "file.txt"), "initial")
      await git(tempDir, "add .")
      await git(tempDir, "commit -m 'initial'")

      const result = await diffSummary({}, tempDir)

      expect(result).toContain("## Status Overview")
      expect(result).toContain("(no changes)")
    })

    it("should show staged changes", async () => {
      await writeFile(join(tempDir, "file.txt"), "initial")
      await git(tempDir, "add .")
      await git(tempDir, "commit -m 'initial'")

      await writeFile(join(tempDir, "file.txt"), "modified")
      await git(tempDir, "add .")

      const result = await diffSummary({}, tempDir)

      expect(result).toContain("## Status Overview")
      expect(result).toContain("## Staged Changes")
      expect(result).toContain("file.txt")
    })

    it("should show unstaged changes", async () => {
      await writeFile(join(tempDir, "file.txt"), "initial")
      await git(tempDir, "add .")
      await git(tempDir, "commit -m 'initial'")

      await writeFile(join(tempDir, "file.txt"), "modified")

      const result = await diffSummary({}, tempDir)

      expect(result).toContain("## Unstaged Changes")
      expect(result).toContain("file.txt")
    })

    it("should show untracked files", async () => {
      await writeFile(join(tempDir, "file.txt"), "initial")
      await git(tempDir, "add .")
      await git(tempDir, "commit -m 'initial'")

      await writeFile(join(tempDir, "newfile.txt"), "new content")

      const result = await diffSummary({}, tempDir)

      expect(result).toContain("## Untracked Files")
      expect(result).toContain("newfile.txt")
    })
  })

  describe("branches mode", () => {
    it("should compare branches with source and target", async () => {
      await git(tempDir, "checkout -b main")
      await writeFile(join(tempDir, "file.txt"), "initial")
      await git(tempDir, "add .")
      await git(tempDir, "commit -m 'initial'")

      await git(tempDir, "checkout -b feature")
      await writeFile(join(tempDir, "feature.txt"), "feature content")
      await git(tempDir, "add .")
      await git(tempDir, "commit -m 'add feature'")

      const result = await diffSummary({ source: "feature", target: "main", remote: "" }, tempDir)

      expect(result).toContain("## Stats Overview")
      expect(result).toContain("## Commits to Review")
      expect(result).toContain("## Files Changed")
      expect(result).toContain("## Full Diff")
    })
  })
})
