import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const HOOKS_SUBPATH = join("opencode", "hook", "hooks.md")

/**
 * Returns the user-level config directory based on the OS.
 * - Linux/macOS: XDG_CONFIG_HOME or ~/.config
 * - Windows: Checks ~/.config first (cross-platform), then %APPDATA% (fallback)
 *
 * On Windows, prioritizes ~/.config for cross-platform consistency.
 * Falls back to %APPDATA% for backward compatibility with existing installations.
 */
export function getUserConfigDir(): string {
  const defaultDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")

  if (process.platform !== "win32") {
    return defaultDir
  }

  if (existsSync(join(defaultDir, HOOKS_SUBPATH))) {
    return defaultDir
  }

  const appdataDir = process.env.APPDATA || join(homedir(), "AppData", "Roaming")
  if (existsSync(join(appdataDir, HOOKS_SUBPATH))) {
    return appdataDir
  }

  return defaultDir
}

export function getGlobalHookDir(): string {
  return join(getUserConfigDir(), "opencode", "hook")
}

export function getProjectHookDir(directory: string): string {
  return join(directory, ".opencode", "hook")
}
