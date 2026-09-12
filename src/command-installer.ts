import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs"
import { join } from "node:path"
import { log } from "./logger"

export interface InstallFilesResult {
  installed: string[]
  skipped: string[]
  updated: string[]
}

export function installBundledFiles(sourceDir: string, targetDir: string): InstallFilesResult {
  const installed: string[] = []
  const skipped: string[] = []
  const updated: string[] = []
  if (!existsSync(sourceDir)) return { installed, skipped, updated }

  try {
    mkdirSync(targetDir, { recursive: true })
  } catch (error) {
    log("[commands] failed to prepare target dir", { targetDir, error: String(error) })
    return { installed, skipped, updated }
  }

  let files: string[]
  try {
    files = readdirSync(sourceDir)
  } catch (error) {
    log("[commands] failed to read bundled files", { sourceDir, error: String(error) })
    return { installed, skipped, updated }
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue
    const source = join(sourceDir, file)
    const target = join(targetDir, file)
    try {
      const content = readFileSync(source, "utf-8")
      if (!existsSync(target)) {
        copyFileSync(source, target, constants.COPYFILE_EXCL)
        installed.push(file)
        continue
      }
      if (readFileSync(target, "utf-8") !== content) {
        copyFileSync(source, target)
        updated.push(file)
        continue
      }
      skipped.push(file)
    } catch (error) {
      log("[commands] failed to install bundled file", { file, error: String(error) })
    }
  }

  return { installed, skipped, updated }
}
