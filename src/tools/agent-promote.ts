import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../logger"
import {
  type AgentMode,
  VALID_GRADES,
  validateGrade,
  validateAgentName,
} from "./agent-promote-core"

export {
  type AgentMode,
  VALID_GRADES,
  validateGrade,
  validateAgentName,
} from "./agent-promote-core"

export interface AgentPromoteArgs {
  name: string
  grade?: string
}

const MODE_LINE = /^mode:.*$/m

export function updateFrontmatterMode(content: string, mode: AgentMode): string {
  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---", 3)
    if (end !== -1) {
      const head = content.slice(0, end)
      const tail = content.slice(end)
      return MODE_LINE.test(head)
        ? head.replace(MODE_LINE, `mode: ${mode}`) + tail
        : `${head}\nmode: ${mode}${tail}`
    }
  }
  return `---\nmode: ${mode}\n---\n\n${content}`
}

export function readFrontmatterMode(content: string): AgentMode | undefined {
  if (!content.startsWith("---\n")) return undefined
  const end = content.indexOf("\n---", 3)
  if (end === -1) return undefined
  const match = content.slice(0, end).match(/^mode:[ \t]*(\S+)/m)
  return match ? (match[1] as AgentMode) : undefined
}

export function createAgentPromoteTool(
  bundledAgentDir: string,
  globalAgentDir: string,
  pluginAgentNames: string[]
) {
  return {
    name: "agent-promote",
    description: "Change the type of an agent to primary, subagent or all",
    input: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the agent" },
        grade: {
          type: "string",
          description: "Target type: 'subagent', 'primary', or 'all' (default: primary)",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(input: unknown) {
      const args = input as AgentPromoteArgs
      const { name } = args
      const grade = args.grade?.trim() || "primary"

      if (!validateGrade(grade)) {
        return { content: `Invalid grade "${grade}". Valid grades: ${VALID_GRADES.join(", ")}` }
      }

      if (!validateAgentName(name, pluginAgentNames)) {
        return {
          content: `Agent "${name}" not found in this plugin. Available: ${pluginAgentNames.join(", ")}`,
        }
      }

      const bundledPath = join(bundledAgentDir, `${name}.md`)
      const globalPath = join(globalAgentDir, `${name}.md`)

      let content: string
      try {
        content = readFileSync(bundledPath, "utf-8")
      } catch (error) {
        log("[agent-promote] failed to read bundled agent file", {
          path: bundledPath,
          error: String(error),
        })
        return { content: `Failed to read agent file: ${bundledPath}` }
      }

      if (readFrontmatterMode(content) === grade) {
        return { content: `Agent "${name}" is already of type "${grade}"` }
      }

      const updated = updateFrontmatterMode(content, grade as AgentMode)
      try {
        writeFileSync(bundledPath, updated)
        writeFileSync(globalPath, updated)
      } catch (error) {
        log("[agent-promote] failed to write agent file", {
          bundledPath,
          globalPath,
          error: String(error),
        })
        return { content: `Failed to update agent files for "${name}". Check plugin logs for details.` }
      }

      log("[agent-promote] Agent type changed", { name, grade })
      return { content: `Agent "${name}" changed to type "${grade}".` }
    },
  }
}
