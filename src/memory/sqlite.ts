import { Database } from "bun:sqlite"

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

export function openSqlite(path: string): SqliteDatabase {
  if (!path) throw new Error("A SQLite path is required")
  const database = new Database(path)
  database.exec("PRAGMA journal_mode=WAL")
  database.exec("PRAGMA busy_timeout=5000")
  database.exec("PRAGMA foreign_keys=ON")
  return database as unknown as SqliteDatabase
}
