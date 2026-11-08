import { randomUUID } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { asRecord } from "../record"
import { openSqlite, type SqliteDatabase } from "./sqlite"

export function backupDatabase(database: SqliteDatabase, path: string, label = "backup"): { path: string; bytes: number } {
  if (!path) throw new Error("A database path is required to back up memory")
  const target = `${path}.${label}-${randomUUID()}.bak`
  const bytes = database.serialize()
  writeFileSync(target, bytes, { flag: "wx", mode: 0o600, flush: true })
  if (!Buffer.from(bytes).equals(readFileSync(target))) throw new Error(`Memory backup verification failed: ${target}`)
  const copy = openSqlite(target)
  try {
    copy.exec("PRAGMA journal_mode=DELETE")
    if (asRecord(copy.prepare("PRAGMA integrity_check").get()).integrity_check !== "ok") {
      throw new Error(`Memory backup integrity check failed: ${target}`)
    }
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    for (const table of tables) {
      const name = String(asRecord(table).name).replaceAll('"', '""')
      const sql = `SELECT count(*) AS count FROM "${name}"`
      if (asRecord(copy.prepare(sql).get()).count !== asRecord(database.prepare(sql).get()).count) {
        throw new Error(`Memory backup count mismatch for ${name}: ${target}`)
      }
    }
  } finally {
    copy.close()
  }
  return { path: target, bytes: readFileSync(target).length }
}
