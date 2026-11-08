import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { loadAgents, loadSkills } from "./loaders"
import { getGlobalAgentDir, getGlobalCommandDir } from "./config-paths"
import { log } from "./logger"
import {
  gitingestTool,
  pdfToMarkdownTool,
  createListChildSessionsTool,
  createSessionContextTool,
  createOrchestratorLoopTools,
  createTaskBoardTool,
  createKnowledgeTool,
  createMemoryBackupTool,
  createMemoryReviewTool,
  createMemoryOverviewTool,
  createAgentPromoteTool,
} from "./tools"
import { buildSkillActivationBlock } from "./skill-activation"
import { installBundledFiles } from "./command-installer"
import { applyAgents, createAgentModes } from "./agent-runtime"
import { migrateAgentCopies } from "./agent-migration"
import { createOrchestratorLoop } from "./orchestrator-loop"
import { createOrchestratorClients } from "./orchestrator-api"
import { createSessionContextClient } from "./session-context-api"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_ROOT = join(__dirname, "..")
const AGENT_DIR = join(PLUGIN_ROOT, "agent")
const COMMAND_DIR = join(PLUGIN_ROOT, "command")
const SKILL_DIR = join(PLUGIN_ROOT, "skill")

export default Plugin.define({
  id: "opencode-froggy",
  async setup(ctx) {
    const agents = loadAgents(AGENT_DIR)
    const skills = loadSkills(SKILL_DIR)
    const emptyInstall = { installed: [] as string[], skipped: [] as string[], updated: [] as string[] }
    let installedCommands = { ...emptyInstall }
    try {
      installedCommands = installBundledFiles(COMMAND_DIR, getGlobalCommandDir())
    } catch (error) {
      log("[init] failed to install commands", { error: String(error) })
    }
    const migration = migrateAgentCopies(AGENT_DIR, getGlobalAgentDir())
    if (migration.backups.length || migration.conflicts.length) log("[agents] legacy migration", migration)
    const modes = createAgentModes(Object.keys(agents), () => ctx.agent.reload())
    await ctx.agent.transform((editor) => applyAgents(editor, agents, modes.values))
    try {
      await ctx.command.reload()
    } catch (error) {
      log("[init] failed to reload commands", { error: String(error) })
    }

    const skillsWithTriggers = skills.filter((s) => s.useWhen)
    const skillActivationBlock =
      skillsWithTriggers.length > 0 ? buildSkillActivationBlock(skillsWithTriggers) : null

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

    const controller = new AbortController()
    const orchestratorClients = createOrchestratorClients(ctx.session)
    const orchestratorLoop = createOrchestratorLoop({
      directory: ctx.location.directory,
      storage: ctx.storage,
      session: orchestratorClients.session,
    })
    const { startTool: startOrchestratorLoopTool, stopTool: stopOrchestratorLoopTool, statusTool: orchestratorStatusTool } = createOrchestratorLoopTools(orchestratorLoop)
    const listChildSessionsTool = createListChildSessionsTool(orchestratorClients.listChildren)
    const sessionContextClient = createSessionContextClient({
      readContext: (sessionID) => ctx.session.context({ sessionID }),
      listModels: async (directory) => (await ctx.model.list({ location: { directory } })).data,
    })
    const sessionContextTool = createSessionContextTool(ctx.location.project.id, ctx.location.directory, {
      client: sessionContextClient,
      verifySession: orchestratorClients.verifySession,
    })
    const agentPromoteTool = createAgentPromoteTool(ctx.agent, modes.set, Object.keys(agents))

    // Memory is shared across worktrees; the loop above belongs to this location.
    const tools = [
      createTaskBoardTool(ctx.location.project.canonical),
      createKnowledgeTool(ctx.location.project.canonical),
      createMemoryBackupTool(ctx.location.project.canonical),
      createMemoryReviewTool(ctx.location.project.canonical),
      createMemoryOverviewTool(ctx.location.project.canonical),
      gitingestTool,
      pdfToMarkdownTool,
      listChildSessionsTool,
      sessionContextTool,
      startOrchestratorLoopTool,
      stopOrchestratorLoopTool,
      orchestratorStatusTool,
      agentPromoteTool,
    ]
    await ctx.tool.transform((editor) => {
      for (const tool of tools) editor.add(tool)
    })

    log("[init] Plugin loaded", {
      agents: Object.keys(agents),
      commandsInstalled: installedCommands.installed,
      commandsUpdated: installedCommands.updated,
      skills: skills.map((s) => s.name),
      skillsWithTriggers: skillsWithTriggers.map((s) => s.name),
      tools: tools.map((tool) => tool.name),
    })

    if (skillActivationBlock) {
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text: skillActivationBlock })
      })
    }

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.deleted") continue
          const { sessionID } = event.data
          log("[event] session.deleted", { sessionID })
          try {
            await orchestratorLoop.stop(sessionID)
          } catch (error) {
            log("[orchestrator-loop] failed to clean up deleted session", { sessionID, error: String(error) })
          }
        }
      } catch (error) {
        if ((error as { name?: string })?.name !== "AbortError") {
          log("[event] subscription ended", { error: String(error) })
        }
      }
    })()

    function cleanup(): Promise<void> {
      controller.abort()
      return orchestratorLoop.close()
    }

    try {
      await orchestratorLoop.restore()
    } catch (error) {
      await cleanup()
      throw error
    }

    return cleanup
  },
})
