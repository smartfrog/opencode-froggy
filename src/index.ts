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

export { parseFrontmatter, loadAgents, loadSkills, loadCommands } from "./loaders"

// ============================================================================
// TYPES
// ============================================================================

interface CountdownState {
  timer: ReturnType<typeof setTimeout>
  interval: ReturnType<typeof setInterval>
}

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

const AUTO_SKILL_NAME = "post-change-code-simplification"
const COUNTDOWN_SECONDS = 5

// ============================================================================
// PLUGIN
// ============================================================================

const SmartfrogPlugin: Plugin = async (ctx) => {
  const agents = loadAgents(AGENT_DIR)
  const skills = loadSkills(SKILL_DIR)
  const commands = loadCommands(COMMAND_DIR)

  const modifiedCodeFiles = new Map<string, Set<string>>()
  let mainSessionID: string | undefined
  const countdowns = new Map<string, CountdownState>()

  const autoSkill = skills.find((s) => s.name === AUTO_SKILL_NAME)

  function cancelCountdown(sessionID: string): void {
    const state = countdowns.get(sessionID)
    if (state) {
      clearTimeout(state.timer)
      clearInterval(state.interval)
      countdowns.delete(sessionID)
    }
  }

  function startCountdown(sessionID: string, files: Set<string>): void {
    cancelCountdown(sessionID)

    const showCountdownToast = (seconds: number) =>
      ctx.client.tui
        .showToast({
          body: {
            title: "Code Simplification",
            message: `Simplifying in ${seconds}s... (${files.size} files)`,
            variant: "info",
            duration: 900,
          },
        })
        .catch(() => {})

    let remaining = COUNTDOWN_SECONDS
    showCountdownToast(remaining)

    const interval = setInterval(() => {
      remaining--
      if (remaining > 0) {
        showCountdownToast(remaining)
      }
    }, 1000)

    const timer = setTimeout(() => {
      cancelCountdown(sessionID)
      executeSkill(sessionID, files)
    }, COUNTDOWN_SECONDS * 1000)

    countdowns.set(sessionID, { timer, interval })
  }

  async function executeSkill(
    sessionID: string,
    files: Set<string>
  ): Promise<void> {
    if (!autoSkill) return

    const prompt = [
      `[SYSTEM - AUTO CODE SIMPLIFICATION]`,
      ``,
      `Code files were modified during this session:`,
      ...Array.from(files).map((f) => `- ${f}`),
      ``,
      `Execute the skill "${AUTO_SKILL_NAME}" to simplify the changes.`,
      `Use the \`skill\` tool with name="${AUTO_SKILL_NAME}" to load instructions.`,
    ].join("\n")

    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: prompt }] },
        query: { directory: ctx.directory },
      })
    } catch (error) {
      console.debug("[SmartfrogPlugin] executeSkill failed:", error)
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
        }
      }

      if (event.type === "session.deleted") {
        const info = props?.info as { id?: string } | undefined
        if (info?.id) {
          modifiedCodeFiles.delete(info.id)
          cancelCountdown(info.id)
          if (info.id === mainSessionID) {
            mainSessionID = undefined
          }
        }
      }

      if (event.type === "message.updated") {
        const info = props?.info as
          | { sessionID?: string; role?: string }
          | undefined
        if (
          info?.sessionID &&
          info?.role === "user" &&
          countdowns.has(info.sessionID)
        ) {
          cancelCountdown(info.sessionID)
          ctx.client.tui
            .showToast({
              body: {
                title: "Code Simplification",
                message: "Cancelled",
                variant: "warning",
                duration: 2000,
              },
            })
            .catch(() => {})
        }
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        if (sessionID !== mainSessionID) return

        const files = modifiedCodeFiles.get(sessionID)
        if (!files || files.size === 0) return

        if (!autoSkill) return

        modifiedCodeFiles.delete(sessionID)
        startCountdown(sessionID, files)
      }
    },
  }
}

export default SmartfrogPlugin
