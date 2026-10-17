import { asRecord } from "./record"

export const CONTEXT_CATEGORIES = [
  "system",
  "user",
  "assistant",
  "reasoning",
  "tool calls",
  "tool results",
  "compaction",
  "other",
] as const

export type ContextCategory = typeof CONTEXT_CATEGORIES[number]

const DISPLAY_CATEGORIES: ContextCategory[] = [
  "reasoning",
  "tool calls",
  "tool results",
  "system",
  "compaction",
  "assistant",
  "user",
  "other",
]

export interface SessionTokens {
  input: number
  output: number
  cacheRead: number
}

export interface SessionSummary {
  id: string
  parentID: string | null
  title: string | null
  agent: string | null
  model: string
  modelKey: string | null
  cost: number
  tokens: SessionTokens
}

export interface ContextAnalysis {
  messages: number
  characters: number
  categories: Record<ContextCategory, number>
  percentages: Record<ContextCategory, number>
  promptTokens: number | null
  contextLimit: number | null
  usedPercent: number | null
  attachments: number
}

export interface SessionContextRow {
  session: SessionSummary
  analysis: ContextAnalysis | null
  error: string | null
}

const text = (value: unknown): string => typeof value === "string" ? value : ""
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const finiteNumber = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0

function jsonLength(value: unknown): number {
  if (value === undefined || value === null) return 0
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

function promptTokens(value: unknown): number | null {
  const tokens = asRecord(value)
  if (typeof tokens.input !== "number" || !Number.isFinite(tokens.input)) return null
  const cache = asRecord(tokens.cache)
  return tokens.input + finiteNumber(cache.read) + finiteNumber(cache.write)
}

export function parseTokens(value: unknown): SessionTokens {
  const tokens = asRecord(value)
  const cache = asRecord(tokens.cache)
  return {
    input: finiteNumber(tokens.input),
    output: finiteNumber(tokens.output),
    cacheRead: finiteNumber(cache.read),
  }
}

export function modelLabel(value: unknown): { label: string; key: string | null } {
  const model = asRecord(value)
  const provider = text(model.providerID)
  const id = text(model.modelID) || text(model.id)
  const variant = text(model.variant)
  if (!provider || !id) return { label: "?", key: null }
  return {
    label: `${provider}/${id}${variant ? `#${variant}` : ""}`,
    key: `${provider}/${id}`,
  }
}

export function analyzeContext(messages: unknown[], contextLimit: number | null): ContextAnalysis {
  const categories = Object.fromEntries(CONTEXT_CATEGORIES.map((category) => [category, 0])) as Record<ContextCategory, number>
  let attachments = 0
  let lastPromptTokens: number | null = null

  for (const rawMessage of messages) {
    const message = asRecord(rawMessage)
    switch (message.type) {
      case "system":
      case "synthetic":
      case "skill":
        categories.system += text(message.text).length
        break
      case "user":
        categories.user += text(message.text).length
        attachments += array(message.files).length
        break
      case "assistant": {
        const stepTokens = promptTokens(message.tokens)
        if (stepTokens !== null) lastPromptTokens = stepTokens
        for (const rawPart of array(message.content)) {
          const part = asRecord(rawPart)
          if (part.type === "text") {
            categories.assistant += text(part.text).length
          } else if (part.type === "reasoning") {
            categories.reasoning += text(part.text).length
          } else if (part.type === "tool") {
            const state = asRecord(part.state)
            categories["tool calls"] += jsonLength(state.input)
            for (const rawContent of array(state.content)) {
              const content = asRecord(rawContent)
              if (content.type === "text") {
                categories["tool results"] += text(content.text).length
              } else if (content.type === "file") {
                attachments += 1
              }
            }
            if (state.error !== undefined) categories["tool results"] += jsonLength(state.error)
          }
        }
        break
      }
      case "compaction":
        categories.compaction += text(message.summary).length + text(message.recent).length
        break
      case "shell": {
        const output = typeof message.output === "string" ? message.output : text(asRecord(message.output).output)
        categories.other += text(message.command).length + output.length
        break
      }
      default:
        break
    }
  }

  const characters = CONTEXT_CATEGORIES.reduce((total, category) => total + categories[category], 0)
  const percentages = Object.fromEntries(CONTEXT_CATEGORIES.map((category) => [
    category,
    characters === 0 ? 0 : categories[category] / characters * 100,
  ])) as Record<ContextCategory, number>
  const limit = typeof contextLimit === "number" && Number.isFinite(contextLimit) && contextLimit > 0 ? contextLimit : null

  return {
    messages: messages.length,
    characters,
    categories,
    percentages,
    promptTokens: lastPromptTokens,
    contextLimit: limit,
    usedPercent: lastPromptTokens !== null && limit !== null ? lastPromptTokens / limit * 100 : null,
    attachments,
  }
}

export function formatTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

export function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "n/a" : `${value.toFixed(1)}%`
}

function truncate(value: string, width: number): string {
  const characters = Array.from(value.replace(/\s+/g, " ").trim())
  if (characters.length <= width) return characters.join("")
  return characters.slice(0, Math.max(0, width - 1)).join("") + "…"
}

function pad(value: string, width: number): string {
  return truncate(value, width).padEnd(width)
}

function sessionName(session: SessionSummary): string {
  return truncate(session.title ?? "(untitled)", 50)
}

function agentKind(session: SessionSummary): string {
  return `${session.agent ?? "?"} (${session.parentID ? "sub" : "main"})`
}

function agentModel(session: SessionSummary): string {
  return `${agentKind(session)} · ${session.model}`
}

function contextLabel(analysis: ContextAnalysis | null): string {
  if (!analysis) return "n/a"
  const base = `${formatTokens(analysis.promptTokens)} / ${formatTokens(analysis.contextLimit)}`
  return analysis.usedPercent === null ? base : `${base} (${formatPercent(analysis.usedPercent)})`
}

function cumulativeTokens(session: SessionSummary): string {
  return `${formatTokens(session.tokens.input)} / ${formatTokens(session.tokens.output)} / ${formatTokens(session.tokens.cacheRead)}`
}

function categoryLines(analysis: ContextAnalysis): string[] {
  if (analysis.characters === 0) return ["   categories: no active text"]
  const parts = DISPLAY_CATEGORIES.map((category) => `${category} ${analysis.percentages[category].toFixed(1)}%`)
  const prefix = "   categories: "
  const continuation = " ".repeat(prefix.length)
  const lines: string[] = []
  let current = prefix
  for (const part of parts) {
    const separator = current === prefix ? "" : " · "
    if (current.length + separator.length + part.length > 130 && current !== prefix) {
      lines.push(current)
      current = continuation + part
    } else {
      current += separator + part
    }
  }
  if (current !== prefix) lines.push(current)
  return lines
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()
}

export function formatSessionContextMarkdown(rows: SessionContextRow[], options: { limitError?: string | null } = {}): string {
  const lines = [
    `### Session context — ${rows.length} most recent session${rows.length === 1 ? "" : "s"}`,
    "",
    "| # | Session | Agent · Model | Context / Limit (used) | Cost | Cumul session (in/out/cache) |",
    "|---|---------|---------------|------------------------|------|-------------------------------|",
  ]

  rows.forEach((entry, index) => {
    const { session, analysis } = entry
    lines.push(`| ${index + 1} | ${markdownCell(sessionName(session))} | ${markdownCell(agentModel(session))} | ${contextLabel(analysis)} | ${formatCost(session.cost)} | ${cumulativeTokens(session)} |`)
  })

  lines.push(
    "",
    "### Categories",
    "",
    `| # | Agent (kind) | Cost | ${DISPLAY_CATEGORIES.join(" | ")} |`,
    `|---|--------------|------|${DISPLAY_CATEGORIES.map(() => "---").join("|")}|`,
  )
  rows.forEach((entry, index) => {
    const { session, analysis } = entry
    const values = analysis
      ? DISPLAY_CATEGORIES.map((category) => formatPercent(analysis.percentages[category]))
      : DISPLAY_CATEGORIES.map(() => "—")
    lines.push(`| ${index + 1} | ${markdownCell(agentKind(session))} | ${formatCost(session.cost)} | ${values.join(" | ")} |`)
  })
  const analyzed = rows.filter((entry): entry is SessionContextRow & { analysis: ContextAnalysis } => entry.analysis !== null)
  const totalCharacters = analyzed.reduce((total, entry) => total + entry.analysis.characters, 0)
  const totalCost = rows.reduce((total, entry) => total + entry.session.cost, 0)
  const globalValues = DISPLAY_CATEGORIES.map((category) => {
    if (totalCharacters === 0) return "—"
    const categoryCharacters = analyzed.reduce((total, entry) => total + entry.analysis.categories[category], 0)
    return formatPercent(categoryCharacters / totalCharacters * 100)
  })
  lines.push(`| **Global** | **all sessions** | **${formatCost(totalCost)}** | ${globalValues.map((value) => `**${value}**`).join(" | ")} |`)

  if (options.limitError) lines.push("", `**Model limits unavailable:** ${markdownCell(options.limitError)}`)
  const errors = rows
    .map((entry, index) => entry.error ? `- **#${index + 1}** error: ${markdownCell(entry.error)}` : null)
    .filter((line): line is string => line !== null)
  if (errors.length > 0) lines.push("", ...errors)
  const attachments = rows
    .map((entry, index) => entry.analysis && entry.analysis.attachments > 0
      ? `- **#${index + 1}** attachments: ${entry.analysis.attachments} (excluded from percentages)`
      : null)
    .filter((line): line is string => line !== null)
  if (attachments.length > 0) lines.push("", ...attachments)

  lines.push(
    "",
    "Context / Limit = last assistant prompt tokens / model window; the percentage is in parentheses.",
    "Cumul session = cumulative input / output / cache read across all calls, not the active context.",
    "Categories = share of active context characters after the last compaction.",
    "Global = weighted category share across analyzed sessions; cost is the total of the listed sessions.",
  )
  return lines.join("\n")
}

export function formatSessionContextReport(rows: SessionContextRow[], options: { limitError?: string | null } = {}): string {
  const lines = [
    `Active context — ${rows.length} most recent session${rows.length === 1 ? "" : "s"} in this project`,
    "Context / Limit = last assistant prompt tokens / model window; percentage in parentheses",
    "Cost = total session cost in USD",
    "Cumul session = cumulative input / output / cache read across all calls, not the active context",
    "Categories = share of active context characters after the last compaction",
  ]
  if (options.limitError) lines.push(`Model limits unavailable: ${options.limitError}`)
  lines.push("")

  const widths = [2, 34, 46, 30, 8, 24]
  const headers = ["#", "Session", "Agent · Model", "Context / Limit (used)", "Cost", "Cumul session (in/out/cache)"]
  const row = (values: string[]) => values.map((value, index) => pad(value, widths[index])).join(" ").trimEnd()
  lines.push(row(headers))

  rows.forEach((entry, index) => {
    const { session, analysis, error } = entry
    lines.push(row([
      String(index + 1),
      sessionName(session),
      agentModel(session),
      contextLabel(analysis),
      formatCost(session.cost),
      cumulativeTokens(session),
    ]))
    if (analysis) {
      lines.push(...categoryLines(analysis))
      if (analysis.attachments > 0) {
        lines.push(`   attachments: ${analysis.attachments} file${analysis.attachments === 1 ? "" : "s"} (excluded from percentages)`)
      }
    }
    if (error) lines.push(`   error: ${error}`)
  })

  lines.push("")
  lines.push("Source: messages after the last compaction.")
  return lines.join("\n")
}
