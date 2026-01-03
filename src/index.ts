import { tool, type Plugin, type ToolContext } from "@opencode-ai/plugin"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadAgents,
  loadSkills,
  loadCommands,
  loadHooks,
  type HookConfig,
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
const HOOK_DIR = join(PLUGIN_ROOT, "hook")

// ============================================================================
// PLUGIN
// ============================================================================

const SmartfrogPlugin: Plugin = async (ctx) => {
  const agents = loadAgents(AGENT_DIR)
  const skills = loadSkills(SKILL_DIR)
  const commands = loadCommands(COMMAND_DIR)
  const hooks = loadHooks(HOOK_DIR)

  const modifiedCodeFiles = new Map<string, Set<string>>()
  let mainSessionID: string | undefined

  log("[init] Plugin loaded", { 
    agents: Object.keys(agents), 
    commands: Object.keys(commands),
    skills: skills.map(s => s.name),
    hooks: Array.from(hooks.keys()),
  })

  async function executeHookActions(hook: HookConfig, sessionID: string): Promise<void> {
    log("[executeHookActions] Starting", { event: hook.event, sessionID, actionsCount: hook.actions.length })

    for (const action of hook.actions) {
      try {
        if ("command" in action) {
          const cmdName = typeof action.command === "string" ? action.command : action.command.name
          const cmdArgs = typeof action.command === "string" ? "" : action.command.args
          const cmdConfig = commands[cmdName]
          
          log("[executeHookActions] Executing command", { command: cmdName, args: cmdArgs, agent: cmdConfig?.agent, model: cmdConfig?.model })
          await ctx.client.session.command({
            path: { id: sessionID },
            body: { 
              command: cmdName,
              arguments: cmdArgs,
              agent: cmdConfig?.agent,
              model: cmdConfig?.model,
            },
            query: { directory: ctx.directory },
          })
        } else if ("skill" in action) {
          const text = `Use the skill tool to load the "${action.skill}" skill and follow its instructions.`
          
          log("[executeHookActions] Executing skill", { skill: action.skill })
          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text }] },
            query: { directory: ctx.directory },
          })
        } else if ("tool" in action) {
          const text = `Use the ${action.tool.name} tool with these arguments: ${JSON.stringify(action.tool.args)}`
          
          log("[executeHookActions] Executing tool", { tool: action.tool.name })
          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text }] },
            query: { directory: ctx.directory },
          })
        }
      } catch (error) {
        log("[executeHookActions] Action failed, continuing", { error: String(error) })
      }
    }

    log("[executeHookActions] Completed", { event: hook.event })
  }

  function checkHookCondition(hook: HookConfig, sessionID: string): boolean {
    if (hook.condition === "isMainSession") {
      return sessionID === mainSessionID
    }
    return true
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

        const eventHooks = hooks.get("session.created") ?? []
        for (const hook of eventHooks) {
          if (info?.id && checkHookCondition(hook, info.id)) {
            executeHookActions(hook, info.id)
          }
        }
      }

      if (event.type === "session.deleted") {
        const info = props?.info as { id?: string } | undefined
        if (info?.id) {
          log("[event] session.deleted", { sessionID: info.id })

          const eventHooks = hooks.get("session.deleted") ?? []
          for (const hook of eventHooks) {
            if (checkHookCondition(hook, info.id)) {
              await executeHookActions(hook, info.id)
            }
          }

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

        const files = modifiedCodeFiles.get(sessionID)
        if (!files || files.size === 0) {
          log("[event] session.idle - no modified files, skipping")
          return
        }

        const eventHooks = hooks.get("session.idle") ?? []
        if (eventHooks.length === 0) {
          log("[event] session.idle - no hooks defined, skipping")
          return
        }

        modifiedCodeFiles.delete(sessionID)
        log("[event] session.idle - executing hooks", { files: Array.from(files), hooksCount: eventHooks.length })
        
        for (const hook of eventHooks) {
          if (checkHookCondition(hook, sessionID)) {
            await executeHookActions(hook, sessionID)
          }
        }
      }
    },
  }
}

export default SmartfrogPlugin
