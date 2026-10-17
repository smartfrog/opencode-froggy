#!/usr/bin/env bun
import { formatSessionContextMarkdown, formatSessionContextReport } from "../session-context"
import { createSessionContextClient, resolveProjectID } from "../session-context-api"
import { collectSessionContext } from "../session-context-report"

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
const HELP = `Usage: froggy-session-context [--markdown] [limit]
       bun run session-context -- [--markdown] [limit]

Analyze the most recent sessions in the current project, including subagents.
limit: integer from 1 to ${MAX_LIMIT}; defaults to ${DEFAULT_LIMIT}.
--markdown: print a Markdown table and category list instead of the text report.`

interface CliOptions {
  limit: number
  markdown: boolean
}

function parseOptions(args: string[]): CliOptions {
  let markdown = false
  const positional: string[] = []
  for (const arg of args) {
    if (arg === "--markdown") {
      markdown = true
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  if (positional.length > 1) throw new Error("Expected at most one argument: limit")
  const limit = positional.length === 0 ? DEFAULT_LIMIT : Number(positional[0])
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`)
  }
  return { limit, markdown }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP)
    return
  }
  const options = parseOptions(args)
  const projectID = await resolveProjectID(process.cwd())
  const client = createSessionContextClient()
  const report = await collectSessionContext(client, projectID, options.limit, process.cwd())
  if (report.rows.length === 0) {
    console.log("No sessions found for this project.")
    return
  }
  const output = options.markdown
    ? formatSessionContextMarkdown(report.rows, { limitError: report.limitError })
    : formatSessionContextReport(report.rows, { limitError: report.limitError })
  console.log(output)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
