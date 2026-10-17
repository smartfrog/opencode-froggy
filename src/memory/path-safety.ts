import { lstatSync, realpathSync } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"

function stat(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined
    throw error
  }
}

function relativeParts(root: string, target: string): string[] {
  const path = relative(root, target)
  if (!path || path.startsWith("..") || isAbsolute(path)) throw new Error("Memory path escapes the project root")
  return path.split(sep)
}

export function assertSafeDirectory(root: string, target: string): void {
  let current = root
  for (const part of relativeParts(root, target)) {
    current = join(current, part)
    const info = stat(current)
    if (!info) continue
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in the memory path: ${current}`)
    if (!info.isDirectory()) throw new Error(`Memory path is not a directory: ${current}`)
  }
  if (stat(target) && realpathSync(target) !== target) {
    throw new Error("Memory directory resolves outside its canonical path")
  }
}

export function assertSafeFile(root: string, target: string): void {
  relativeParts(root, target)
  const info = stat(target)
  if (!info) return
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed for the memory file: ${target}`)
  if (!info.isFile()) throw new Error(`Memory target must be a regular file: ${target}`)
  if (info.nlink !== 1) throw new Error(`Memory target must have a single hard link: ${target}`)
  if (realpathSync(target) !== target) throw new Error("Memory file resolves outside its canonical path")
}
