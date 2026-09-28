import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  validateGrade,
  validateAgentName,
  VALID_GRADES,
} from "./agent-promote-core"
import {
  createAgentPromoteTool,
  readFrontmatterMode,
  updateFrontmatterMode,
} from "./agent-promote"

const AGENT_MD = `---
description: Strategic thinking partner.
mode: subagent
permissions:
  - action: edit
    resource: "*"
    effect: deny
---

# Strategic Sparring Partner

You are a thinking partner.
`

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

  describe("updateFrontmatterMode", () => {
    it("should replace an existing mode line", () => {
      const result = updateFrontmatterMode(AGENT_MD, "primary")
      expect(result).toContain("mode: primary")
      expect(result).not.toContain("mode: subagent")
    })

    it("should preserve other frontmatter keys and body", () => {
      const result = updateFrontmatterMode(AGENT_MD, "primary")
      expect(result).toContain("description: Strategic thinking partner.")
      expect(result).toContain('- action: edit')
      expect(result).toContain("# Strategic Sparring Partner")
    })

    it("should insert a mode line when frontmatter has none", () => {
      const content = "---\ndescription: No mode here.\n---\n\nBody\n"
      const result = updateFrontmatterMode(content, "all")
      expect(result).toContain("mode: all")
      expect(result).toContain("description: No mode here.")
    })

    it("should prepend frontmatter when content has none", () => {
      const result = updateFrontmatterMode("# Just a body\n", "primary")
      expect(result).toBe("---\nmode: primary\n---\n\n# Just a body\n")
    })
  })

  describe("readFrontmatterMode", () => {
    it("should read the mode from frontmatter", () => {
      expect(readFrontmatterMode(AGENT_MD)).toBe("subagent")
    })

    it("should return undefined without frontmatter", () => {
      expect(readFrontmatterMode("# No frontmatter\n")).toBeUndefined()
    })

    it("should return undefined without a mode key", () => {
      expect(readFrontmatterMode("---\ndescription: x\n---\n\nBody\n")).toBeUndefined()
    })
  })

  describe("createAgentPromoteTool", () => {
    let bundledDir: string
    let globalDir: string

    beforeEach(() => {
      bundledDir = mkdtempSync(join(tmpdir(), "froggy-bundled-"))
      globalDir = mkdtempSync(join(tmpdir(), "froggy-global-"))
      writeFileSync(join(bundledDir, "rubber-duck.md"), AGENT_MD)
      writeFileSync(join(globalDir, "rubber-duck.md"), AGENT_MD)
    })

    afterEach(() => {
      rmSync(bundledDir, { recursive: true, force: true })
      rmSync(globalDir, { recursive: true, force: true })
    })

    async function execute(name: string, grade?: string) {
      const tool = createAgentPromoteTool(bundledDir, globalDir, pluginAgentNames)
      return tool.execute({ name, grade })
    }

    it("should write the new mode to bundled and installed files", async () => {
      const result = await execute("rubber-duck", "primary")
      expect(result.content).toBe('Agent "rubber-duck" changed to type "primary".')

      const bundled = readFileSync(join(bundledDir, "rubber-duck.md"), "utf-8")
      const global = readFileSync(join(globalDir, "rubber-duck.md"), "utf-8")
      expect(bundled).toBe(global)
      expect(readFrontmatterMode(bundled)).toBe("primary")
    })

    it("should default to primary when no grade is given", async () => {
      await execute("rubber-duck")
      const bundled = readFileSync(join(bundledDir, "rubber-duck.md"), "utf-8")
      expect(readFrontmatterMode(bundled)).toBe("primary")
    })

    it("should create the installed file when it is missing", async () => {
      rmSync(join(globalDir, "rubber-duck.md"))
      await execute("rubber-duck", "primary")
      const global = readFileSync(join(globalDir, "rubber-duck.md"), "utf-8")
      expect(readFrontmatterMode(global)).toBe("primary")
    })

    it("should report when the agent already has the grade", async () => {
      const result = await execute("rubber-duck", "subagent")
      expect(result.content).toBe('Agent "rubber-duck" is already of type "subagent"')

      const bundled = readFileSync(join(bundledDir, "rubber-duck.md"), "utf-8")
      expect(readFrontmatterMode(bundled)).toBe("subagent")
    })

    it("should reject an invalid grade", async () => {
      const result = await execute("rubber-duck", "boss")
      expect(result.content).toContain('Invalid grade "boss"')
    })

    it("should reject an agent outside the plugin", async () => {
      const result = await execute("build")
      expect(result.content).toContain('Agent "build" not found in this plugin')
    })

    it("should fail when the bundled file is missing", async () => {
      mkdirSync(join(bundledDir, "architect"), { recursive: true })
      const tool = createAgentPromoteTool(bundledDir, globalDir, ["architect"])
      const result = await tool.execute({ name: "architect" })
      expect(result.content).toContain("Failed to read agent file")
    })
  })
})
