import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { log } from "./logger"

const execFileAsync = promisify(execFile)

const DIFF_CONTEXT_LINES = 5

interface DiffSummaryArgs {
  source?: string
  target?: string
  remote?: string
}

interface DiffSet {
  stats: string
  files: string
  diff: string
}

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 })
    return result.stdout
  } catch (error) {
    const execError = error as { stdout?: string }
    if (execError.stdout) return execError.stdout
    throw error
  }
}

async function getDiffSet(cwd: string, extraArgs: string[] = []): Promise<DiffSet> {
  const [stats, files, diff] = await Promise.all([
    git(["diff", ...extraArgs, "--stat"], cwd),
    git(["diff", ...extraArgs, "--name-status"], cwd),
    git(["diff", ...extraArgs, `-U${DIFF_CONTEXT_LINES}`, "--function-context"], cwd),
  ])
  return { stats, files, diff }
}

async function getBranchesDiff(
  source: string,
  target: string,
  remote: string,
  cwd: string
): Promise<string> {
  const refSource = remote ? `${remote}/${source}` : source
  const refTarget = remote ? `${remote}/${target}` : target
  const range = `${refTarget}...${refSource}`
  const rangeLog = `${refTarget}..${refSource}`

  if (remote) {
    await git(["fetch", remote, source, target, "--prune"], cwd)
  }

  const [stats, commits, files, diff] = await Promise.all([
    git(["diff", "--stat", range], cwd),
    git(["log", "--oneline", "--no-merges", rangeLog], cwd),
    git(["diff", "--name-only", range], cwd),
    git(["diff", `-U${DIFF_CONTEXT_LINES}`, "--function-context", range], cwd),
  ])

  return [
    "## Stats Overview", "```", stats.trim(), "```",
    "",
    "## Commits to Review", "```", commits.trim(), "```",
    "",
    "## Files Changed", "```", files.trim(), "```",
    "",
    "## Full Diff", "```diff", diff.trim(), "```",
  ].join("\n\n")
}

async function getWorkingTreeDiff(cwd: string): Promise<string> {
  const sections: string[] = []

  const [status, staged, unstaged, untrackedList] = await Promise.all([
    git(["status", "--porcelain=v1", "-uall"], cwd),
    getDiffSet(cwd, ["--cached"]),
    getDiffSet(cwd),
    git(["ls-files", "--others", "--exclude-standard"], cwd),
  ])

  sections.push("## Status Overview", "```", status.trim() || "(no changes)", "```")

  if (staged.stats.trim() || staged.files.trim()) {
    sections.push(
      "## Staged Changes",
      "### Stats", "```", staged.stats.trim() || "(none)", "```",
      "### Files", "```", staged.files.trim() || "(none)", "```",
      "### Diff", "```diff", staged.diff.trim() || "(none)", "```"
    )
  }

  if (unstaged.stats.trim() || unstaged.files.trim()) {
    sections.push(
      "## Unstaged Changes",
      "### Stats", "```", unstaged.stats.trim() || "(none)", "```",
      "### Files", "```", unstaged.files.trim() || "(none)", "```",
      "### Diff", "```diff", unstaged.diff.trim() || "(none)", "```"
    )
  }

  const untrackedFiles = untrackedList.trim().split("\n").filter(Boolean)

  if (untrackedFiles.length > 0) {
    const untrackedDiffs: string[] = []
    for (const file of untrackedFiles) {
      try {
        const fileDiff = await git(
          ["diff", "--no-index", `-U${DIFF_CONTEXT_LINES}`, "--function-context", "--", "/dev/null", file],
          cwd
        )
        untrackedDiffs.push(`=== NEW: ${file} ===\n${fileDiff.trim()}`)
      } catch (error) {
        log("[diff-summary] failed to diff untracked file", { file, error: String(error) })
        untrackedDiffs.push(`=== NEW: ${file} === (could not diff)`)
      }
    }

    sections.push(
      "## Untracked Files",
      "```", untrackedFiles.join("\n"), "```",
      "### Diffs", "```diff", untrackedDiffs.join("\n\n"), "```"
    )
  }

  return sections.join("\n\n")
}

export async function diffSummary(args: DiffSummaryArgs, cwd: string): Promise<string> {
  const { source, target = "main", remote = "origin" } = args

  if (source) {
    return getBranchesDiff(source, target, remote, cwd)
  }

  return getWorkingTreeDiff(cwd)
}
