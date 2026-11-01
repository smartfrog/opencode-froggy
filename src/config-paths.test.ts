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
    it("should return XDG_CONFIG_HOME on Linux when set", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.XDG_CONFIG_HOME = "/custom/config"

      expect(getUserConfigDir()).toBe("/custom/config")
    })

    it("should return ~/.config on Linux when XDG_CONFIG_HOME is not set", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      expect(getUserConfigDir()).toBe(join(homedir(), ".config"))
    })

    it("should return XDG_CONFIG_HOME on macOS when set", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" })
      process.env.XDG_CONFIG_HOME = "/custom/mac/config"

      expect(getUserConfigDir()).toBe("/custom/mac/config")
    })

    it("should return ~/.config on macOS when XDG_CONFIG_HOME is not set", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" })
      delete process.env.XDG_CONFIG_HOME

      expect(getUserConfigDir()).toBe(join(homedir(), ".config"))
    })

    it("should ignore APPDATA on Windows when XDG_CONFIG_HOME is not set", async () => {
      Object.defineProperty(process, "platform", { value: "win32" })
      delete process.env.XDG_CONFIG_HOME
      process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming"

      expect(getUserConfigDir()).toBe(join(homedir(), ".config"))
    })

    it("should honor XDG_CONFIG_HOME on Windows regardless of APPDATA", () => {
      Object.defineProperty(process, "platform", { value: "win32" })
      process.env.XDG_CONFIG_HOME = "/custom/windows/config"
      process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming"

      expect(getUserConfigDir()).toBe("/custom/windows/config")
    })
  })

  describe("getGlobalCommandDir", () => {
    it("should return correct path on Linux", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      expect(getGlobalCommandDir()).toBe(join(homedir(), ".config", "opencode", "commands"))
    })
  })

  describe("getGlobalAgentDir", () => {
    it("should return correct path on Linux", async () => {
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      expect(getGlobalAgentDir()).toBe(join(homedir(), ".config", "opencode", "agents"))
    })
  })

  it.each([
    ["agents", getGlobalAgentDir],
    ["commands", getGlobalCommandDir],
  ] as const)("should resolve Windows %s using XDG_CONFIG_HOME", (name, resolveDirectory) => {
    Object.defineProperty(process, "platform", { value: "win32" })
    process.env.XDG_CONFIG_HOME = "/custom/config"

    expect(resolveDirectory()).toBe(join("/custom/config", "opencode", name))
  })
})
