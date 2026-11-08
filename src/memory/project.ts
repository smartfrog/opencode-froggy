import { existsSync, mkdirSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { assertSafeDirectory, assertSafeFile } from "./path-safety"
import { openSqlite } from "./sqlite"
import { MemoryStore } from "./store"

export interface ProjectMemory {
  path: string
  store: MemoryStore
}

export function openProjectMemory(directory: string, options: { readonly?: boolean; existing?: boolean } = {}): ProjectMemory {
  if (!directory) throw new Error("A project directory is required")
  const root = realpathSync(directory)
  const memoryDirectory = join(root, ".opencode", "memory")
  assertSafeDirectory(root, memoryDirectory)
  if (!options.readonly && !options.existing) mkdirSync(memoryDirectory, { recursive: true })
  assertSafeDirectory(root, memoryDirectory)

  const path = join(memoryDirectory, "memory.db")
  assertSafeFile(root, path)
  assertSafeFile(root, `${path}-wal`)
  assertSafeFile(root, `${path}-shm`)
  assertSafeFile(root, `${path}-journal`)
  if ((options.readonly || options.existing) && !existsSync(path)) throw new Error("No project memory database exists")
  const database = openSqlite(path, options.readonly)
  try {
    assertSafeFile(root, path)
    assertSafeFile(root, `${path}-wal`)
    assertSafeFile(root, `${path}-shm`)
    assertSafeFile(root, `${path}-journal`)
    const requireCurrentSchema = options.readonly || options.existing
    return { path, store: new MemoryStore(database, path, requireCurrentSchema) }
  } catch (error) {
    database.close()
    throw error
  }
}
