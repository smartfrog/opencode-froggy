import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createTemporaryDirectory } from "./temporary-directory"

const directories: string[] = []

function root(): string {
  const directory = mkdtempSync(join(tmpdir(), "froggy-temp-root-"))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("test temporary directories", () => {
  it("uses the preferred parent when it exists", () => {
    const preferred = root()
    const directory = createTemporaryDirectory("fixture-", preferred)
    expect(dirname(directory)).toBe(preferred)
  })

  it("falls back to the system temporary directory when the preferred parent is absent", () => {
    const preferred = join(root(), "missing")
    const directory = createTemporaryDirectory("fixture-", preferred)
    directories.push(directory)
    expect(dirname(directory)).toBe(tmpdir())
    expect(existsSync(preferred)).toBe(false)
  })
})
