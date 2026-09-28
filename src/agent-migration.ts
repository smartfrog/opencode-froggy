import { randomUUID } from "node:crypto"
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { parseFrontmatter } from "./loaders"
import { validateGrade } from "./tools/agent-promote-core"

export function migrateAgentCopies(
  bundledDir: string,
  globalDir: string,
) {
  const result = { backups: [] as string[], conflicts: [] as string[] }
  if (!existsSync(globalDir) || !existsSync(bundledDir)) return result
  const backupDir = join(dirname(globalDir), "froggy-agent-backups", randomUUID())
  for (const file of readdirSync(bundledDir)) {
    if (!file.endsWith(".md")) continue
    const path = join(globalDir, file)
    if (!existsSync(path)) continue
    const content = readFileSync(path, "utf8")
    const installed = parseFrontmatter<Record<string, unknown>>(content)
    const bundled = parseFrontmatter<Record<string, unknown>>(readFileSync(join(bundledDir, file), "utf8"))
    const { mode } = installed.data
    const installedData = { ...installed.data, mode: undefined }
    const bundledData = { ...bundled.data, mode: undefined }
    if (installed.body !== bundled.body || !isDeepStrictEqual(installedData, bundledData) ||
        (mode !== undefined && (typeof mode !== "string" || !validateGrade(mode)))) {
      result.conflicts.push(path)
      continue
    }
    mkdirSync(backupDir, { recursive: true })
    const backup = join(backupDir, file)
    copyFileSync(path, backup, constants.COPYFILE_EXCL)
    if (readFileSync(path, "utf8") !== content) throw new Error(`Agent changed during migration: ${path}`)
    unlinkSync(path)
    result.backups.push(backup)
  }
  return result
}
