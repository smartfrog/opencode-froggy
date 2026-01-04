import { tool, type Plugin, type ToolContext } from "@opencode-ai/plugin"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadAgents,
  loadSkills,
  loadCommands,
  loadHooks,
  mergeHooks,
  type HookConfig,
  type HookEvent,
} from "./loaders"
import { getGlobalHookDir, getProjectHookDir } from "./config-paths"
import { hasCodeExtension } from "./code-files"
import { log } from "./logger"
import {
  executeBashAction,
  DEFAULT_BASH_TIMEOUT,
  type BashContext,
} from "./bash-executor"

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

interface ToolExecuteAfterInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

interface HookExecutionResult {
  blocked: boolean
  blockReason?: string
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

// ============================================================================
// PLUGIN
// ============================================================================

const SmartfrogPlugin: Plugin = async (ctx) => {
  const agents = loadAgents(AGENT_DIR)
  const skills = loadSkills(SKILL_DIR)
  const commands = loadCommands(COMMAND_DIR)

  const globalHooks = loadHooks(getGlobalHookDir())
  const projectHooks = loadHooks(getProjectHookDir(ctx.directory))
  const hooks = mergeHooks(globalHooks, projectHooks)

  const modifiedCodeFiles = new Map<string, Set<string>>()
  const pendingToolArgs = new Map<string, Record<string, unknown>>()
  let mainSessionID: string | undefined

  log("[init] Plugin loaded", { 
    agents: Object.keys(agents), 
    commands: Object.keys(commands),
    skills: skills.map(s => s.name),
    hooks: Array.from(hooks.keys()),
  })

  async function executeHookActions(
    hook: HookConfig, 
    sessionID: string, 
    extraLog?: Record<string, unknown>,
    options?: { canBlock?: boolean }
  ): Promise<HookExecutionResult> {
    const prefix = `[hook:${hook.event}]`
    const canBlock = options?.canBlock ?? false

    const conditions = hook.conditions ?? []

    for (const condition of conditions) {
      if (condition === "isMainSession" && sessionID !== mainSessionID) {
        log(`${prefix} condition not met, skipping`, { sessionID, condition })
        return { blocked: false }
      }

      if (condition === "hasCodeChange") {
        const files = extraLog?.files as string[] | undefined
        if (!files || !files.some(hasCodeExtension)) {
          log(`${prefix} condition not met, skipping`, { sessionID, condition })
          return { blocked: false }
        }
      }
    }

    log(`${prefix} starting`, { 
      sessionID, 
      conditions,
      actions: hook.actions.length, 
      ...extraLog 
    })

    for (const action of hook.actions) {
      try {
        if ("command" in action) {
          const { name, args = "" } = typeof action.command === "string" 
            ? { name: action.command } 
            : action.command
          const { agent, model } = commands[name] ?? {}
          
          log(`${prefix} executing command`, { command: name, args, agent, model })
          const result = await ctx.client.session.command({
            path: { id: sessionID },
            body: { 
              command: name,
              arguments: args,
              agent,
              model,
            },
            query: { directory: ctx.directory },
          })
          log(`${prefix} command result`, { command: name, status: result.response?.status, error: result.error })
        } else if ("tool" in action) {
          log(`${prefix} executing tool`, { tool: action.tool.name })
          const result = await ctx.client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text: `Use the ${action.tool.name} tool with these arguments: ${JSON.stringify(action.tool.args)}` }] },
            query: { directory: ctx.directory },
          })
          log(`${prefix} tool result`, { tool: action.tool.name, status: result.response?.status, error: result.error })
        } else if ("bash" in action) {
          const { command, timeout } = typeof action.bash === "string"
            ? { command: action.bash, timeout: DEFAULT_BASH_TIMEOUT }
            : { command: action.bash.command, timeout: action.bash.timeout ?? DEFAULT_BASH_TIMEOUT }

          const startTime = Date.now()
          log(`${prefix} executing bash`, { command, timeout })

          const bashContext: BashContext = {
            session_id: sessionID,
            event: hook.event,
            cwd: ctx.directory,
            files: extraLog?.files as string[] | undefined,
            tool_name: extraLog?.tool_name as string | undefined,
            tool_args: extraLog?.tool_args as Record<string, unknown> | undefined,
          }

          const result = await executeBashAction(command, timeout, bashContext, ctx.directory)
          const duration = Date.now() - startTime

          const statusIcon = result.exitCode === 0 ? "✓" : "✗"
          const hookMessage = [
            `[BASH HOOK ${statusIcon}] ${command}`,
            `Exit: ${result.exitCode} | Duration: ${duration}ms`,
            result.stdout.trim() ? `Stdout: ${result.stdout.slice(0, 500).trim()}` : null,
            result.stderr.trim() ? `Stderr: ${result.stderr.slice(0, 500).trim()}` : null,
          ].filter(Boolean).join("\n")

          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              noReply: true,
              parts: [{ type: "text", text: hookMessage }],
            },
            query: { directory: ctx.directory },
          }).catch((err) => {
            log(`${prefix} failed to send hook message`, { error: String(err) })
          })

          if (result.exitCode === 2) {
            log(`${prefix} bash exit code 2`, { stderr: result.stderr, canBlock })
            if (canBlock) {
              const blockReason = result.stderr.trim() || "Blocked by hook"
              return { blocked: true, blockReason }
            }
            return { blocked: false }
          }

          if (result.exitCode !== 0) {
            log(`${prefix} bash failed (non-blocking)`, { exitCode: result.exitCode, stderr: result.stderr })
          } else {
            log(`${prefix} bash completed`, { stdout: result.stdout.slice(0, 200) })
          }
        }
      } catch (error) {
        log(`${prefix} action failed, continuing`, { error: String(error) })
      }
    }

    log(`${prefix} completed`)
    return { blocked: false }
  }

  async function triggerHooks(
    event: HookEvent, 
    sessionID: string, 
    extraLog?: Record<string, unknown>,
    options?: { canBlock?: boolean }
  ): Promise<HookExecutionResult> {
    const eventHooks = hooks.get(event)
    if (!eventHooks) return { blocked: false }

    for (const hook of eventHooks) {
      const result = await executeHookActions(hook, sessionID, extraLog, options)
      if (result.blocked) return result
    }
    return { blocked: false }
  }

  async function triggerToolHooks(
    phase: "before" | "after",
    toolName: string,
    sessionID: string,
    toolArgs: Record<string, unknown>
  ): Promise<HookExecutionResult> {
    const canBlock = phase === "before"
    const extraLog = { tool_name: toolName, tool_args: toolArgs }

    const wildcardEvent = `tool.${phase}.*` as HookEvent
    const wildcardResult = await triggerHooks(wildcardEvent, sessionID, extraLog, { canBlock })
    if (wildcardResult.blocked) return wildcardResult

    const specificEvent = `tool.${phase}.${toolName}` as HookEvent
    const specificResult = await triggerHooks(specificEvent, sessionID, extraLog, { canBlock })
    return specificResult
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

      const toolArgs = output.args ?? {}
      
      pendingToolArgs.set(input.callID, toolArgs)

      const result = await triggerToolHooks("before", input.tool, sessionID, toolArgs)
      if (result.blocked) {
        pendingToolArgs.delete(input.callID)
        throw new Error(result.blockReason ?? "Blocked by hook")
      }

      if (["write", "edit"].includes(input.tool)) {
        const filePath = (toolArgs.filePath ?? toolArgs.file_path ?? toolArgs.path) as string | undefined
        if (filePath) {
          log("[tool.execute.before] File modified", { sessionID, filePath, tool: input.tool })

          let files = modifiedCodeFiles.get(sessionID)
          if (!files) {
            files = new Set()
            modifiedCodeFiles.set(sessionID, files)
          }
          files.add(filePath)
        }
      }
    },

    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      _output: ToolExecuteAfterOutput
    ): Promise<void> => {
      const sessionID = input.sessionID
      if (!sessionID) return

      const toolArgs = pendingToolArgs.get(input.callID) ?? {}
      pendingToolArgs.delete(input.callID)
      
      await triggerToolHooks("after", input.tool, sessionID, toolArgs)
    },

    event: async ({ event }) => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.created") {
        const info = props?.info as { id?: string; parentID?: string } | undefined
        const sessionID = info?.id
        if (!sessionID) return

        if (!info.parentID) {
          mainSessionID = sessionID
          log("[event] session.created - main session", { sessionID })
        }

        await triggerHooks("session.created", sessionID)
      }

      if (event.type === "session.deleted") {
        const info = props?.info as { id?: string } | undefined
        const sessionID = info?.id
        if (!sessionID) return

        log("[event] session.deleted", { sessionID })
        await triggerHooks("session.deleted", sessionID)

        modifiedCodeFiles.delete(sessionID)
        if (sessionID === mainSessionID) {
          mainSessionID = undefined
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

        const eventHooks = hooks.get("session.idle")
        if (!eventHooks || eventHooks.length === 0) {
          log("[event] session.idle - no hooks defined, skipping")
          return
        }

        const files = modifiedCodeFiles.get(sessionID)
        modifiedCodeFiles.delete(sessionID)
        await triggerHooks("session.idle", sessionID, { files: files ? Array.from(files) : [] })
      }
    },
  }
}

export default SmartfrogPlugin
