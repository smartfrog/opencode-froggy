import { homedir } from "node:os"
import { join } from "node:path"

export function getUserConfigDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
}

export function getGlobalCommandDir(): string {
  return join(getUserConfigDir(), "opencode", "commands")
}

export function getGlobalAgentDir(): string {
  return join(getUserConfigDir(), "opencode", "agents")
}
