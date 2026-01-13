import { describe, it, expect } from "vitest"
import {
  validateGrade,
  validateAgentName,
  getPromotedAgents,
  setPromotedAgent,
  VALID_GRADES,
  type AgentMode,
} from "./agent-promote-core"

describe("agent-promote", () => {
  const pluginAgentNames = ["rubber-duck", "architect", "code-reviewer"]

  describe("VALID_GRADES", () => {
    it("should contain subagent, primary, and all", () => {
      expect(VALID_GRADES).toContain("subagent")
      expect(VALID_GRADES).toContain("primary")
      expect(VALID_GRADES).toContain("all")
      expect(VALID_GRADES).toHaveLength(3)
    })
  })

  describe("validateGrade", () => {
    it("should return true for valid grade: subagent", () => {
      expect(validateGrade("subagent")).toBe(true)
    })

    it("should return true for valid grade: primary", () => {
      expect(validateGrade("primary")).toBe(true)
    })

    it("should return true for valid grade: all", () => {
      expect(validateGrade("all")).toBe(true)
    })

    it("should return false for invalid grade", () => {
      expect(validateGrade("invalid")).toBe(false)
      expect(validateGrade("foo")).toBe(false)
      expect(validateGrade("")).toBe(false)
    })
  })

  describe("validateAgentName", () => {
    it("should return true for agent in plugin", () => {
      expect(validateAgentName("rubber-duck", pluginAgentNames)).toBe(true)
      expect(validateAgentName("architect", pluginAgentNames)).toBe(true)
      expect(validateAgentName("code-reviewer", pluginAgentNames)).toBe(true)
    })

    it("should return false for agent not in plugin", () => {
      expect(validateAgentName("unknown", pluginAgentNames)).toBe(false)
      expect(validateAgentName("build", pluginAgentNames)).toBe(false)
      expect(validateAgentName("", pluginAgentNames)).toBe(false)
    })
  })

  describe("promotedAgents Map", () => {
    it("should set and get promoted agent", () => {
      setPromotedAgent("test-agent-1", "primary")
      const promoted = getPromotedAgents()
      expect(promoted.get("test-agent-1")).toBe("primary")
    })

    it("should update existing promotion", () => {
      setPromotedAgent("test-agent-2", "primary")
      expect(getPromotedAgents().get("test-agent-2")).toBe("primary")

      setPromotedAgent("test-agent-2", "all")
      expect(getPromotedAgents().get("test-agent-2")).toBe("all")

      setPromotedAgent("test-agent-2", "subagent")
      expect(getPromotedAgents().get("test-agent-2")).toBe("subagent")
    })

    it("should handle multiple agents", () => {
      setPromotedAgent("agent-a", "primary")
      setPromotedAgent("agent-b", "all")
      setPromotedAgent("agent-c", "subagent")

      const promoted = getPromotedAgents()
      expect(promoted.get("agent-a")).toBe("primary")
      expect(promoted.get("agent-b")).toBe("all")
      expect(promoted.get("agent-c")).toBe("subagent")
    })

    it("should return readonly map", () => {
      const promoted = getPromotedAgents()
      expect(typeof promoted.get).toBe("function")
      expect(typeof promoted.has).toBe("function")
      expect(typeof promoted.forEach).toBe("function")
    })
  })
})
