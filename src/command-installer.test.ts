import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { installBundledFiles } from "./command-installer"

describe("installBundledFiles", () => {
  let sourceDir: string
  let targetDir: string

  beforeEach(() => {
    const base = join(tmpdir(), `froggy-files-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    sourceDir = join(base, "source")
    targetDir = join(base, "target")
    mkdirSync(sourceDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(join(sourceDir, ".."), { recursive: true, force: true })
  })

  it("installs missing files", () => {
    writeFileSync(join(sourceDir, "review-pr.md"), "# review")
    const result = installBundledFiles(sourceDir, targetDir)
    expect(result.installed).toEqual(["review-pr.md"])
    expect(readFileSync(join(targetDir, "review-pr.md"), "utf-8")).toBe("# review")
  })

  it("skips existing files with identical content", () => {
    writeFileSync(join(sourceDir, "review-pr.md"), "# bundled")
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, "review-pr.md"), "# bundled")
    const result = installBundledFiles(sourceDir, targetDir)
    expect(result.skipped).toEqual(["review-pr.md"])
    expect(readFileSync(join(targetDir, "review-pr.md"), "utf-8")).toBe("# bundled")
  })

  it("updates an existing file when the bundled content differs", () => {
    writeFileSync(join(sourceDir, "review-pr.md"), "# v2")
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, "review-pr.md"), "# v1")
    const result = installBundledFiles(sourceDir, targetDir)
    expect(result.updated).toEqual(["review-pr.md"])
    expect(readFileSync(join(targetDir, "review-pr.md"), "utf-8")).toBe("# v2")
  })

  it("never deletes a user-customized file", () => {
    writeFileSync(join(sourceDir, "review-pr.md"), "# bundled")
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, "review-pr.md"), "# user customization")
    const result = installBundledFiles(sourceDir, targetDir)
    expect(result.updated).toEqual(["review-pr.md"])
    expect(existsSync(join(targetDir, "review-pr.md"))).toBe(true)
  })

  it("ignores non-markdown files", () => {
    writeFileSync(join(sourceDir, "notes.txt"), "notes")
    const result = installBundledFiles(sourceDir, targetDir)
    expect(result.installed).toEqual([])
    expect(existsSync(join(targetDir, "notes.txt"))).toBe(false)
  })

  it("returns empty result for missing source dir", () => {
    const result = installBundledFiles(join(sourceDir, "missing"), targetDir)
    expect(result).toEqual({ installed: [], skipped: [], updated: [] })
  })
})
