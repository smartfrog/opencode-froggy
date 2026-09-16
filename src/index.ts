import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import {
  loadAgents,
  loadHooks,
  loadSkills,
  mergeHooks,
  type HookConfig,
  type HookEvent,
} from "./loaders"
import { getGlobalAgentDir, getGlobalCommandDir, getGlobalHookDir, getProjectHookDir } from "./config-paths"
import { hasCodeExtension } from "./code-files"
import { log } from "./logger"
import {
  executeBashAction,
  DEFAULT_BASH_TIMEOUT,
  type BashContext,
} from "./bash-executor"
import {
  gitingestTool,
  pdfToMarkdownTool,
  createPromptSessionTool,
  createListChildSessionsTool,
  createAgentPromoteTool,
  setPromotedAgent,
  getPromotedAgents,
  AGENT_PROMOTE_STORAGE_KEY,
  type AgentMode,
  ethTransactionTool,
  ethAddressTxsTool,
  ethAddressBalanceTool,
  ethTokenTransfersTool,
} from "./tools"
import { buildSkillActivationBlock } from "./skill-activation"
import { installBundledFiles } from "./command-installer"
import { ChildSessionTracker } from "./session-children"

export { parseFrontmatter, loadAgents, loadCommands, type LoadedSkill } from "./loaders"
export { buildSkillActivationBlock } from "./skill-activation"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_ROOT = join(__dirname, "..")
const AGENT_DIR = join(PLUGIN_ROOT, "agent")
const COMMAND_DIR = join(PLUGIN_ROOT, "command")
const SKILL_DIR = join(PLUGIN_ROOT, "skill")

const TRACKED_FILE_TOOLS = new Set(["write", "edit", "patch"])

interface HookExecutionResult {
  blocked: boolean
  blockReason?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readSessionID(event: unknown): string | undefined {
  const data = asRecord(asRecord(event).data)
  const sessionID = data.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function readParentID(event: unknown): string | undefined {
  const data = asRecord(asRecord(event).data)
  const parentID = data.parentID
  return typeof parentID === "string" ? parentID : undefined
}

function readTitle(event: unknown): string | undefined {
  const data = asRecord(asRecord(event).data)
  const title = data.title
  return typeof title === "string" ? title : undefined
}

export default Plugin.define({
  id: "opencode-froggy",
  async setup(ctx) {
    const agents = loadAgents(AGENT_DIR)
    const skills = loadSkills(SKILL_DIR)
    const emptyInstall = { installed: [] as string[], skipped: [] as string[], updated: [] as string[] }
    let installedCommands = { ...emptyInstall }
    let installedAgents = { ...emptyInstall }
    try {
      installedCommands = installBundledFiles(COMMAND_DIR, getGlobalCommandDir())
    } catch (error) {
      log("[init] failed to install commands", { error: String(error) })
    }
    try {
      installedAgents = installBundledFiles(AGENT_DIR, getGlobalAgentDir())
    } catch (error) {
      log("[init] failed to install agents", { error: String(error) })
    }
    try {
      await ctx.agent.reload()
    } catch (error) {
      log("[init] failed to reload agents", { error: String(error) })
    }
    try {
      await ctx.command.reload()
    } catch (error) {
      log("[init] failed to reload commands", { error: String(error) })
    }

    const globalHooks = loadHooks(getGlobalHookDir())
    const projectHooks = loadHooks(getProjectHookDir(ctx.location.directory))
    const hooks = mergeHooks(globalHooks, projectHooks)

    const modifiedCodeFiles = new Map<string, Set<string>>()
    const tracker = new ChildSessionTracker()

    try {
      const stored = await ctx.storage.get(AGENT_PROMOTE_STORAGE_KEY)
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [name, mode] of Object.entries(stored as Record<string, unknown>)) {
          if (mode === "primary" || mode === "subagent" || mode === "all") {
            setPromotedAgent(name, mode as AgentMode)
          }
        }
      }
    } catch (error) {
      log("[init] failed to load promoted agents", { error: String(error) })
    }

    const skillsWithTriggers = skills.filter((s) => s.useWhen)
    const skillActivationBlock =
      skillsWithTriggers.length > 0 ? buildSkillActivationBlock(skillsWithTriggers) : null

    log("[init] Plugin loaded", {
      agents: Object.keys(agents),
      commandsInstalled: installedCommands.installed,
      commandsUpdated: installedCommands.updated,
      agentsInstalled: installedAgents.installed,
      agentsUpdated: installedAgents.updated,
      skills: skills.map((s) => s.name),
      skillsWithTriggers: skillsWithTriggers.map((s) => s.name),
      hooks: Array.from(hooks.keys()),
      tools: [
        "gitingest",
        "pdf-to-markdown",
        "prompt-session",
        "list-child-sessions",
        "agent-promote",
        "eth-transaction",
        "eth-address-txs",
        "eth-address-balance",
        "eth-token-transfers",
      ],
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
        if (condition === "isMainSession") {
          try {
            const sessionInfo = (await ctx.session.get({ sessionID })) as unknown as {
              parentID?: string
            }
            if (sessionInfo?.parentID) {
              log(`${prefix} condition not met, skipping`, { sessionID, condition })
              return { blocked: false }
            }
          } catch (error) {
            log(`${prefix} failed to check session, continuing`, { error: String(error) })
          }
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
        ...extraLog,
      })

      for (const action of hook.actions) {
        try {
          if ("command" in action) {
            const { name, args = "" } =
              typeof action.command === "string" ? { name: action.command } : action.command
            log(`${prefix} executing command`, { command: name, args })
            await ctx.session.command({ sessionID, name, text: args })
          } else if ("tool" in action) {
            log(`${prefix} executing tool`, { tool: action.tool.name })
            await ctx.session.prompt({
              sessionID,
              text: `Use the ${action.tool.name} tool with these arguments: ${JSON.stringify(action.tool.args)}`,
            })
          } else if ("bash" in action) {
            const { command, timeout } =
              typeof action.bash === "string"
                ? { command: action.bash, timeout: DEFAULT_BASH_TIMEOUT }
                : { command: action.bash.command, timeout: action.bash.timeout ?? DEFAULT_BASH_TIMEOUT }

            const startTime = Date.now()
            log(`${prefix} executing bash`, { command, timeout })

            const bashContext: BashContext = {
              session_id: sessionID,
              event: hook.event,
              cwd: ctx.location.directory,
              files: extraLog?.files as string[] | undefined,
              tool_name: extraLog?.tool_name as string | undefined,
              tool_args: extraLog?.tool_args as Record<string, unknown> | undefined,
            }

            const result = await executeBashAction(command, timeout, bashContext, ctx.location.directory)
            const duration = Date.now() - startTime

            const statusIcon = result.exitCode === 0 ? "✓" : "✗"
            const hookMessage = [
              `[BASH HOOK ${statusIcon}] ${command}`,
              `Exit: ${result.exitCode} | Duration: ${duration}ms`,
              result.stdout.trim() ? `Stdout: ${result.stdout.slice(0, 500).trim()}` : null,
              result.stderr.trim() ? `Stderr: ${result.stderr.slice(0, 500).trim()}` : null,
            ]
              .filter(Boolean)
              .join("\n")

            await ctx.session
              .synthetic({ sessionID, text: hookMessage })
              .catch((err: unknown) => {
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
              log(`${prefix} bash failed (non-blocking)`, {
                exitCode: result.exitCode,
                stderr: result.stderr,
              })
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
      return triggerHooks(specificEvent, sessionID, extraLog, { canBlock })
    }

    function trackModifiedFile(sessionID: string, toolName: string, toolArgs: Record<string, unknown>): void {
      if (!TRACKED_FILE_TOOLS.has(toolName)) return
      const filePath = (toolArgs.filePath ?? toolArgs.file_path ?? toolArgs.path) as string | undefined
      if (!filePath) return
      log("[tool.execute.before] File modified", { sessionID, filePath, tool: toolName })
      let files = modifiedCodeFiles.get(sessionID)
      if (!files) {
        files = new Set()
        modifiedCodeFiles.set(sessionID, files)
      }
      files.add(filePath)
    }

    await ctx.agent.transform((editor) => {
      for (const [name, mode] of getPromotedAgents()) {
        if (!editor.get(name)) continue
        editor.update(name, (agent) => {
          agent.mode = mode
        })
      }
    })

    await ctx.skill.transform((editor) => {
      type SkillInfo = Parameters<typeof editor.add>[0]
      for (const skill of skills) {
        editor.add({
          id: skill.name as SkillInfo["id"],
          name: skill.name as SkillInfo["name"],
          description: skill.description || undefined,
          path: skill.path as SkillInfo["path"],
          content: skill.body,
        })
      }
    })

    const promptSessionTool = createPromptSessionTool(ctx.session, tracker)
    const listChildSessionsTool = createListChildSessionsTool(tracker)
    const agentPromoteTool = createAgentPromoteTool(ctx.agent, ctx.agent, ctx.storage, Object.keys(agents))

    await ctx.tool.transform((editor) => {
      editor.add(gitingestTool)
      editor.add(pdfToMarkdownTool)
      editor.add(promptSessionTool)
      editor.add(listChildSessionsTool)
      editor.add(agentPromoteTool)
      editor.add(ethTransactionTool)
      editor.add(ethAddressTxsTool)
      editor.add(ethAddressBalanceTool)
      editor.add(ethTokenTransfersTool)
    })

    await ctx.tool.hook("execute.before", async (event) => {
      if (!event.sessionID) return
      const toolArgs = asRecord(event.input)
      const result = await triggerToolHooks("before", event.tool, event.sessionID, toolArgs)
      if (result.blocked) {
        throw new Error(result.blockReason ?? "Blocked by hook")
      }
      trackModifiedFile(event.sessionID, event.tool, toolArgs)
    })

    await ctx.tool.hook("execute.after", async (event) => {
      if (!event.sessionID) return
      const toolArgs = asRecord(event.input)
      await triggerToolHooks("after", event.tool, event.sessionID, toolArgs)
    })

    if (skillActivationBlock) {
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text: skillActivationBlock })
      })
    }

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const record = event as unknown as { type?: string }
          if (record.type === "session.created") {
            const sessionID = readSessionID(event)
            if (!sessionID) continue
            const parentID = readParentID(event)
            if (parentID) {
              tracker.trackChild({
                id: sessionID,
                parentID,
                title: readTitle(event),
                created: Date.now(),
                updated: Date.now(),
              })
            } else {
              log("[event] session.created - main session", { sessionID })
            }
            await triggerHooks("session.created", sessionID)
          }

          if (record.type === "session.deleted") {
            const sessionID = readSessionID(event)
            if (!sessionID) continue
            log("[event] session.deleted", { sessionID })
            await triggerHooks("session.deleted", sessionID)
            modifiedCodeFiles.delete(sessionID)
            tracker.removeSession(sessionID)
          }

          if (record.type === "session.idle") {
            const sessionID = readSessionID(event)
            if (!sessionID) continue
            log("[event] session.idle", { sessionID })
            if (!hooks.has("session.idle")) {
              log("[event] session.idle - no hooks defined, skipping")
              continue
            }
            const files = modifiedCodeFiles.get(sessionID)
            modifiedCodeFiles.delete(sessionID)
            await triggerHooks("session.idle", sessionID, {
              files: files ? Array.from(files) : [],
            })
          }
        }
      } catch (error) {
        if ((error as { name?: string })?.name !== "AbortError") {
          log("[event] subscription ended", { error: String(error) })
        }
      }
    })()

    return () => controller.abort()
  },
})
