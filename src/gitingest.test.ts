import { describe, it, expect } from "vitest"

interface GitingestResponse {
  summary: string
  tree: string
  content: string
}

async function callGitingestApi(args: {
  url: string
  maxFileSize?: number
  pattern?: string
  patternType?: "include" | "exclude"
}): Promise<string> {
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

describe("gitingest tool", () => {
  it("should fetch repository content from a known public repo", async () => {
    const result = await callGitingestApi({
      url: "https://github.com/octocat/Hello-World",
    })

    expect(result).toContain("Repository:")
    expect(result).toContain("hello-world")
    expect(result).toContain("Directory structure:")
    expect(result).toContain("README")
  })

  it("should respect maxFileSize parameter", async () => {
    const result = await callGitingestApi({
      url: "https://github.com/octocat/Hello-World",
      maxFileSize: 10000,
    })

    expect(result).toContain("Repository:")
  })

  it("should handle include pattern", async () => {
    const result = await callGitingestApi({
      url: "https://github.com/octocat/Hello-World",
      pattern: "README*",
      patternType: "include",
    })

    expect(result).toContain("README")
  })

  it("should throw error for invalid repository", async () => {
    await expect(
      callGitingestApi({
        url: "https://github.com/nonexistent-user-12345/nonexistent-repo-67890",
      })
    ).rejects.toThrow()
  })
})
