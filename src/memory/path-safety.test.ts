import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { openProjectMemory } from "./project"

const directories: string[] = []

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "froggy-path-"))
  directories.push(directory)
  return directory
}

function memoryDirectory(directory: string): string {
  return join(directory, ".opencode", "memory")
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("project memory paths", () => {
  it("rejects a memory directory symlinked into another project", () => {
    const target = project()
    const opened = openProjectMemory(target)
    opened.store.saveTask("B", { title: "Other project" }, "build", "ses_test")
    opened.store.close()

    const source = project()
    mkdirSync(join(source, ".opencode"), { recursive: true })
    symlinkSync(memoryDirectory(target), memoryDirectory(source))

    expect(() => openProjectMemory(source)).toThrow("Symbolic links")
  })

  it("rejects a database file symlinked into another project", () => {
    const target = project()
    const opened = openProjectMemory(target)
    opened.store.saveTask("B", { title: "Other project" }, "build", "ses_test")
    opened.store.close()
    const targetDatabase = join(memoryDirectory(target), "memory.db")

    const source = project()
    mkdirSync(memoryDirectory(source), { recursive: true })
    symlinkSync(targetDatabase, join(memoryDirectory(source), "memory.db"))

    expect(() => openProjectMemory(source)).toThrow("Symbolic links")
    const check = openProjectMemory(target)
    expect(check.store.getTask("B")).toMatchObject({ title: "Other project" })
    check.store.close()
  })

  it("rejects a database file with multiple hard links", () => {
    const target = project()
    const opened = openProjectMemory(target)
    opened.store.saveTask("B", { title: "Other project" }, "build", "ses_test")
    opened.store.close()
    const targetDatabase = join(memoryDirectory(target), "memory.db")

    const source = project()
    mkdirSync(memoryDirectory(source), { recursive: true })
    linkSync(targetDatabase, join(memoryDirectory(source), "memory.db"))

    expect(() => openProjectMemory(source)).toThrow("single hard link")
  })
})
