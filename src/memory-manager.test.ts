import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadAgents } from "./loaders"

function memoryManager() {
  const agent = loadAgents(fileURLToPath(new URL("../agent/", import.meta.url)))["memory-manager"]
  if (!agent) throw new Error("Bundled memory-manager agent is missing")
  return agent
}

describe("bundled memory manager", () => {
  it("is available as a subagent", () => {
    expect(memoryManager().mode).toBe("subagent")
  })

  it.each([
    ["read", "allow"],
    ["glob", "allow"],
    ["grep", "allow"],
    ["memory-file", "allow"],
    ["edit", "deny"],
    ["shell", "deny"],
    ["execute", "deny"],
    ["subagent", "deny"],
    ["webfetch", "deny"],
    ["trelloWriteCard", "deny"],
  ])("resolves %s permission to %s", (action, effect) => {
    const rules = memoryManager().permissions
    if (!Array.isArray(rules)) throw new Error("Expected ordered permission rules")
    const rule = [...rules].reverse().find((item) => item.action === action || item.action === "*")
    expect(rule?.effect).toBe(effect)
  })
})
