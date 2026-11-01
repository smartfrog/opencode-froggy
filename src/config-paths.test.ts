import { homedir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, afterEach } from "bun:test"
import { getUserConfigDir, getGlobalCommandDir, getGlobalAgentDir } from "./config-paths"

describe("config-paths", () => {
  const originalPlatform = process.platform
  const originalEnv = { ...process.env }

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    process.env = { ...originalEnv }
  })

  describe("getUserConfigDir", () => {
    it.each([
      ["linux", "/custom/config"], ["linux", undefined],
      ["darwin", "/custom/mac/config"], ["darwin", undefined],
      ["win32", "/custom/windows/config"], ["win32", undefined],
    ] as const)("resolves %s with XDG_CONFIG_HOME=%s independently of APPDATA", (platform, xdg) => {
      Object.defineProperty(process, "platform", { value: platform })
      if (xdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = xdg
      process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming"

      expect(getUserConfigDir()).toBe(xdg ?? join(homedir(), ".config"))
    })
  })

  it.each([
    ["agents", "linux", undefined, getGlobalAgentDir],
    ["commands", "linux", undefined, getGlobalCommandDir],
    ["agents", "win32", "/custom/config", getGlobalAgentDir],
    ["commands", "win32", "/custom/config", getGlobalCommandDir],
  ] as const)("resolves %s on %s with XDG_CONFIG_HOME=%s", (name, platform, xdg, resolveDirectory) => {
    Object.defineProperty(process, "platform", { value: platform })
    if (xdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = xdg

    expect(resolveDirectory()).toBe(join(xdg ?? join(homedir(), ".config"), "opencode", name))
  })
})
