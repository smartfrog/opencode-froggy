import { tool, type Plugin, type ToolContext } from "@opencode-ai/plugin"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadAgents,
  loadSkills,
  loadCommands,
  type LoadedSkill,
  type CommandConfig,
  type AgentConfigOutput,
} from "./loaders"
import { log } from "./logger"

export { parseFrontmatter, loadAgents, loadSkills, loadCommands } from "./loaders"

// ============================================================================
// TYPES
// ============================================================================

interface ToolExecuteBeforeInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
}

// ============================================================================
// CONSTANTS
// ============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_ROOT = join(__dirname, "..")
const AGENT_DIR = join(PLUGIN_ROOT, "agent")
const SKILL_DIR = join(PLUGIN_ROOT, "skill")
const COMMAND_DIR = join(PLUGIN_ROOT, "command")

const AUTO_COMMAND_NAME = "simplify-changes"

// ============================================================================
// PLUGIN
// ============================================================================

const SmartfrogPlugin: Plugin = async (ctx) => {
  const agents = loadAgents(AGENT_DIR)
  const skills = loadSkills(SKILL_DIR)
  const commands = loadCommands(COMMAND_DIR)

  const modifiedCodeFiles = new Map<string, Set<string>>()
  let mainSessionID: string | undefined

  const autoCommand = commands[AUTO_COMMAND_NAME]
  log("[init] Plugin loaded", { 
    autoCommand: autoCommand ? AUTO_COMMAND_NAME : undefined, 
    agents: Object.keys(agents), 
    commands: Object.keys(commands),
    skills: skills.map(s => s.name) 
  })

  async function executeAutoSimplify(sessionID: string): Promise<void> {
    log("[executeAutoSimplify] Starting", { sessionID })

    if (!autoCommand) {
      log("[executeAutoSimplify] No autoCommand found, skipping")
      return
    }

    try {
      log("[executeAutoSimplify] Sending command to session")
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: `/${AUTO_COMMAND_NAME}` }] },
        query: { directory: ctx.directory },
      })
      log("[executeAutoSimplify] Command sent successfully")
    } catch (error) {
      log("[executeAutoSimplify] Failed", { error: String(error) })
    }
  }

  return {
    config: async (config: Record<string, unknown>): Promise<void> => {
      if (Object.keys(agents).length > 0) {
        config.agent = { ...(config.agent as Record<string, unknown> ?? {}), ...agents }
      }
      if (Object.keys(commands).length > 0) {
        config.command = { ...(config.command as Record<string, unknown> ?? {}), ...commands }
      }
    },

    tool: {
      skill: tool({
        description: `Load a skill to get detailed instructions for a specific task. Skills provide specialized knowledge and step-by-step guidance. Use this when a task matches an available skill's description. <available_skills>${skills.map((s) => `\n  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`).join("")}\n</available_skills>`,
        args: {
          name: tool.schema
            .string()
            .describe(
              "The skill identifier from available_skills (e.g., 'post-change-code-simplification')"
            ),
        },
        async execute(args: { name: string }, _context: ToolContext) {
          const skill = skills.find((s) => s.name === args.name)
          if (!skill) {
            const available = skills.map((s) => s.name).join(", ")
            throw new Error(
              `Skill "${args.name}" not found. Available skills: ${available || "none"}`
            )
          }

          return [
            `## Skill: ${skill.name}`,
            "",
            `**Base directory**: ${dirname(skill.path)}`,
            "",
            skill.body,
          ].join("\n")
        },
      }),
    },

    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput
    ): Promise<void> => {
      const sessionID = input.sessionID
      if (!sessionID) return

      if (!["write", "edit"].includes(input.tool)) return

      const filePath = (output.args?.filePath ?? output.args?.file_path ?? output.args?.path) as string | undefined
      if (!filePath) return

      log("[tool.execute.before] File modified", { sessionID, filePath, tool: input.tool })

      let files = modifiedCodeFiles.get(sessionID)
      if (!files) {
        files = new Set()
        modifiedCodeFiles.set(sessionID, files)
      }
      files.add(filePath)
    },

    event: async ({ event }) => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.created") {
        const info = props?.info as
          | { id?: string; parentID?: string }
          | undefined
        if (info?.id && !info.parentID) {
          mainSessionID = info.id
          log("[event] session.created - main session", { sessionID: info.id })
        }
      }

      if (event.type === "session.deleted") {
        const info = props?.info as { id?: string } | undefined
        if (info?.id) {
          log("[event] session.deleted", { sessionID: info.id })
          modifiedCodeFiles.delete(info.id)
          if (info.id === mainSessionID) {
            mainSessionID = undefined
          }
        }
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        log("[event] session.idle", { sessionID, mainSessionID })

        if (!sessionID) return

        if (!mainSessionID) {
          mainSessionID = sessionID
          log("[event] session.idle - setting mainSessionID from idle event", { sessionID })
        }

        if (sessionID !== mainSessionID) {
          log("[event] session.idle - not main session, skipping")
          return
        }

        const files = modifiedCodeFiles.get(sessionID)
        if (!files || files.size === 0) {
          log("[event] session.idle - no modified files, skipping")
          return
        }

        if (!autoCommand) {
          log("[event] session.idle - no autoCommand, skipping")
          return
        }

        modifiedCodeFiles.delete(sessionID)
        log("[event] session.idle - executing command", { files: Array.from(files) })
        executeAutoSimplify(sessionID)
      }
    },
  }
}

export default SmartfrogPlugin
