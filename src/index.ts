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
  createMemoryReviewTool,
  createMemoryOverviewTool,
  createAgentPromoteTool,
} from "./tools"
import { buildSkillActivationBlock } from "./skill-activation"
import { installBundledFiles } from "./command-installer"
import { ChildSessionTracker } from "./session-children"
import { applyAgents, createAgentModes } from "./agent-runtime"
import { migrateAgentCopies } from "./agent-migration"
import { createOrchestratorLoop } from "./orchestrator-loop"
import { createOrchestratorClients } from "./orchestrator-api"
import { createSessionContextClient } from "./session-context-api"
import { asRecord } from "./record"

export { parseFrontmatter, loadAgents, loadCommands, type LoadedSkill } from "./loaders"
export { buildSkillActivationBlock } from "./skill-activation"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PLUGIN_ROOT = join(__dirname, "..")
const AGENT_DIR = join(PLUGIN_ROOT, "agent")
const COMMAND_DIR = join(PLUGIN_ROOT, "command")
const SKILL_DIR = join(PLUGIN_ROOT, "skill")

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

    const tracker = new ChildSessionTracker()

    const skillsWithTriggers = skills.filter((s) => s.useWhen)
    const skillActivationBlock =
      skillsWithTriggers.length > 0 ? buildSkillActivationBlock(skillsWithTriggers) : null

    log("[init] Plugin loaded", {
      agents: Object.keys(agents),
      commandsInstalled: installedCommands.installed,
      commandsUpdated: installedCommands.updated,
      skills: skills.map((s) => s.name),
      skillsWithTriggers: skillsWithTriggers.map((s) => s.name),
      tools: [
        "gitingest",
        "pdf-to-markdown",
        "list-child-sessions",
        "session-context",
        "task-board",
        "knowledge",
        "memory-overview",
        "memory-review",
        "start-orchestrator-loop",
        "stop-orchestrator-loop",
        "orchestrator-status",
        "agent-promote",
      ],
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

    const controller = new AbortController()
    const orchestratorClients = createOrchestratorClients(ctx.session)
    const orchestratorLoop = createOrchestratorLoop({
      directory: ctx.location.directory,
      storage: ctx.storage,
      session: orchestratorClients.session,
    })
    const { startTool: startOrchestratorLoopTool, stopTool: stopOrchestratorLoopTool, statusTool: orchestratorStatusTool } = createOrchestratorLoopTools(orchestratorLoop)
    const listChildSessionsTool = createListChildSessionsTool(tracker, orchestratorClients.listChildren)
    const sessionContextClient = createSessionContextClient({
      readContext: (sessionID) => ctx.session.context({ sessionID }),
      listModels: async (directory) => (await ctx.model.list({ location: { directory } })).data,
    })
    const sessionContextTool = createSessionContextTool(ctx.location.project.id, ctx.location.directory, {
      client: sessionContextClient,
      verifySession: async (sessionID) => {
        const host = asRecord(await ctx.session.get({ sessionID }))
        const remote = await sessionContextClient.getSession(sessionID)
        if (remote.id !== sessionID || remote.created !== asRecord(host.time).created) {
          throw new Error("The opencode CLI must connect to the same OpenCode service as this plugin")
        }
      },
    })
    const agentPromoteTool = createAgentPromoteTool(ctx.agent, modes.set, Object.keys(agents))

    await ctx.tool.transform((editor) => {
      // Memory is shared across worktrees; the loop above belongs to this location.
      editor.add(createTaskBoardTool(ctx.location.project.canonical))
      editor.add(createKnowledgeTool(ctx.location.project.canonical))
      editor.add(createMemoryReviewTool(ctx.location.project.canonical))
      editor.add(createMemoryOverviewTool(ctx.location.project.canonical))
      editor.add(gitingestTool)
      editor.add(pdfToMarkdownTool)
      editor.add(listChildSessionsTool)
      editor.add(sessionContextTool)
      editor.add(startOrchestratorLoopTool)
      editor.add(stopOrchestratorLoopTool)
      editor.add(orchestratorStatusTool)
      editor.add(agentPromoteTool)
    })

    if (skillActivationBlock) {
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text: skillActivationBlock })
      })
    }

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
          }

          if (record.type === "session.deleted") {
            const sessionID = readSessionID(event)
            if (!sessionID) continue
            log("[event] session.deleted", { sessionID })
            tracker.removeSession(sessionID)
            try {
              await orchestratorLoop.stop(sessionID)
            } catch (error) {
              log("[orchestrator-loop] failed to clean up deleted session", { sessionID, error: String(error) })
            }
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
