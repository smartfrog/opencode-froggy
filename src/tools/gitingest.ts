import { tool, type ToolContext } from "@opencode-ai/plugin"

interface GitingestResponse {
  summary: string
  tree: string
  content: string
}

export interface GitingestArgs {
  url: string
  maxFileSize?: number
  pattern?: string
  patternType?: "include" | "exclude"
}

export async function fetchGitingest(args: GitingestArgs): Promise<string> {
  const response = await fetch("https://gitingest.com/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_text: args.url,
      max_file_size: args.maxFileSize ?? 50000,
      pattern: args.pattern ?? "",
      pattern_type: args.patternType ?? "exclude",
    }),
  })

  if (!response.ok) {
    throw new Error(`gitingest API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as GitingestResponse
  return `${data.summary}\n\n${data.tree}\n\n${data.content}`
}

export const gitingestTool = tool({
  description:
    "Fetch a GitHub repository's full content via gitingest.com. Returns summary, directory tree, and file contents optimized for LLM analysis. Use when you need to understand an external repository's structure or code.",
  args: {
    url: tool.schema
      .string()
      .describe("GitHub repository URL (e.g., https://github.com/owner/repo)"),
    maxFileSize: tool.schema
      .number()
      .optional()
      .describe("Maximum file size in bytes to include (default: 50000)"),
    pattern: tool.schema
      .string()
      .optional()
      .describe("Glob pattern to filter files (e.g., '*.py' or 'src/*')"),
    patternType: tool.schema
      .enum(["include", "exclude"])
      .optional()
      .describe("Whether pattern includes or excludes matching files (default: exclude)"),
  },
  async execute(args: GitingestArgs, _context: ToolContext) {
    return fetchGitingest(args)
  },
})
