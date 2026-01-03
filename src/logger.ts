import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const LOG_FILE = join(tmpdir(), "opencode-froggy.log")

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const entry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`
    appendFileSync(LOG_FILE, entry)
  } catch {}
}

export function getLogFilePath(): string {
  return LOG_FILE
}
