import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { openProjectMemory } from "./project"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("project memory", () => {
  it("enforces read-only access at the SQLite connection", () => {
    const directory = mkdtempSync(join(tmpdir(), "froggy-project-memory-"))
    directories.push(directory)
    openProjectMemory(directory).store.close()
    const memory = openProjectMemory(directory, { readonly: true })
    try {
      expect(() => memory.store.saveTask("T", { title: "Must not be saved" })).toThrow(/readonly|read-only/)
      expect(memory.store.getTask("T")).toBeNull()
    } finally {
      memory.store.close()
    }
  })

  it("uses one canonical database per project and reopens its state", () => {
    const directory = mkdtempSync(join(tmpdir(), "froggy-project-memory-"))
    directories.push(directory)

    const first = openProjectMemory(directory)
    expect(first.path).toBe(join(directory, ".opencode", "memory", "memory.db"))
    first.store.saveTask("T", { title: "Persisted" })
    first.store.close()

    const second = openProjectMemory(directory)
    expect(second.store.getTask("T")).toMatchObject({ id: "T", title: "Persisted", version: 1 })
    second.store.close()
  })
})
