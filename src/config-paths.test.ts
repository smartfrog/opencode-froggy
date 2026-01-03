import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import { homedir } from "node:os"

describe("config-paths", () => {
  const originalPlatform = process.platform
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    process.env = { ...originalEnv }
    vi.doUnmock("node:fs")
  })

  describe("getUserConfigDir", () => {
    it("should return XDG_CONFIG_HOME on Linux when set", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.XDG_CONFIG_HOME = "/custom/config"

      const { getUserConfigDir } = await import("./config-paths")
      expect(getUserConfigDir()).toBe("/custom/config")
    })

    it("should return ~/.config on Linux when XDG_CONFIG_HOME is not set", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      const { getUserConfigDir } = await import("./config-paths")
      expect(getUserConfigDir()).toBe(join(homedir(), ".config"))
    })

    it("should return XDG_CONFIG_HOME on macOS when set", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" })
      process.env.XDG_CONFIG_HOME = "/custom/mac/config"

      const { getUserConfigDir } = await import("./config-paths")
      expect(getUserConfigDir()).toBe("/custom/mac/config")
    })

    it("should return ~/.config on macOS when XDG_CONFIG_HOME is not set", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" })
      delete process.env.XDG_CONFIG_HOME

      const { getUserConfigDir } = await import("./config-paths")
      expect(getUserConfigDir()).toBe(join(homedir(), ".config"))
    })

    it("should return ~/.config on Windows by default", async () => {
      Object.defineProperty(process, "platform", { value: "win32" })
      delete process.env.XDG_CONFIG_HOME
      process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming"

      vi.doMock("node:fs", () => ({
        existsSync: () => false,
      }))

      const { getUserConfigDir } = await import("./config-paths")
      expect(getUserConfigDir()).toBe(join(homedir(), ".config"))
    })

    it("should return APPDATA on Windows when hooks.md exists there but not in ~/.config", async () => {
      Object.defineProperty(process, "platform", { value: "win32" })
      delete process.env.XDG_CONFIG_HOME
      const appdataDir = "C:\\Users\\Test\\AppData\\Roaming"
      process.env.APPDATA = appdataDir

      const appdataHooksPath = join(appdataDir, "opencode", "hook", "hooks.md")

      vi.doMock("node:fs", () => ({
        existsSync: (path: string) => path === appdataHooksPath,
      }))

      const { getUserConfigDir } = await import("./config-paths")
      expect(getUserConfigDir()).toBe(appdataDir)
    })

    it("should prefer ~/.config on Windows when hooks.md exists in both locations", async () => {
      Object.defineProperty(process, "platform", { value: "win32" })
      delete process.env.XDG_CONFIG_HOME
      const appdataDir = "C:\\Users\\Test\\AppData\\Roaming"
      process.env.APPDATA = appdataDir

      const crossPlatformHooksPath = join(homedir(), ".config", "opencode", "hook", "hooks.md")

      vi.doMock("node:fs", () => ({
        existsSync: (path: string) => path === crossPlatformHooksPath,
      }))

      const { getUserConfigDir } = await import("./config-paths")
      expect(getUserConfigDir()).toBe(join(homedir(), ".config"))
    })
  })

  describe("getGlobalHookDir", () => {
    it("should return correct path on Linux", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      const { getGlobalHookDir } = await import("./config-paths")
      expect(getGlobalHookDir()).toBe(join(homedir(), ".config", "opencode", "hook"))
    })

    it("should return correct path with XDG_CONFIG_HOME", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.XDG_CONFIG_HOME = "/custom/config"

      const { getGlobalHookDir } = await import("./config-paths")
      expect(getGlobalHookDir()).toBe("/custom/config/opencode/hook")
    })
  })

  describe("getProjectHookDir", () => {
    it("should return correct path for project directory", async () => {
      const { getProjectHookDir } = await import("./config-paths")
      expect(getProjectHookDir("/my/project")).toBe("/my/project/.opencode/hook")
    })

    it("should handle Windows-style paths", async () => {
      const { getProjectHookDir } = await import("./config-paths")
      const result = getProjectHookDir("C:\\Users\\Test\\project")
      expect(result).toContain(".opencode")
      expect(result).toContain("hook")
    })
  })
})
