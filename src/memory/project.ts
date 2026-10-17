import { mkdirSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { assertSafeDirectory, assertSafeFile } from "./path-safety"
import { openSqlite } from "./sqlite"
import { MemoryStore } from "./store"

export interface ProjectMemory {
  path: string
  store: MemoryStore
}

export function openProjectMemory(directory: string): ProjectMemory {
  if (!directory) throw new Error("A project directory is required")
  const root = realpathSync(directory)
  const memoryDirectory = join(root, ".opencode", "memory")
  assertSafeDirectory(root, memoryDirectory)
  mkdirSync(memoryDirectory, { recursive: true })
  assertSafeDirectory(root, memoryDirectory)

  const path = join(memoryDirectory, "memory.db")
  assertSafeFile(root, path)
  assertSafeFile(root, `${path}-wal`)
  assertSafeFile(root, `${path}-shm`)
  assertSafeFile(root, `${path}-journal`)
  const database = openSqlite(path)
  try {
    assertSafeFile(root, path)
    assertSafeFile(root, `${path}-wal`)
    assertSafeFile(root, `${path}-shm`)
    assertSafeFile(root, `${path}-journal`)
    return { path, store: new MemoryStore(database) }
  } catch (error) {
    database.close()
    throw error
  }
}
