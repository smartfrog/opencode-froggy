# Reference

Detailed reference for commands, skills, and utility tools. For system behavior, start with [Orchestration](orchestration.md) or [Project memory](memory.md); for chain queries, see [Ethereum and EVM tools](ethereum.md).

[Back to README](../README.md)

## Contents

- [Commands](#commands)
- [Skills](#skills)
- [Utility tools](#utility-tools)
- [Configuration](#configuration)

## Commands

| Command | Description | Agent |
|---------|-------------|-------|
| `/agent-promote <name> [grade]` | Promote an agent to primary (default) or specify grade: `subagent`, `primary`, `all` | - |
| `/agent-demote <name>` | Demote an agent to subagent | - |
| `/commit-push` | Stage, commit, and push changes with user confirmation | `build` |
| `/diff-summary [source] [target]` | Show working tree changes or diff between branches | - |
| `/doc-changes` | Update documentation based on uncommitted changes (new features only) | `doc-writer` |
| `/gh-create-pr` | Commit, push, and create a GitHub pull request | `build` |
| `/knowledge [list\|search\|get] ...` | Browse or search project knowledge without modifying it | - |
| `/linear-stale-check` | Review open Linear issues for the configured team and report whether they are likely active, uncertain, or obsolete | `plan` |
| `/memory` | Show task counts by status and knowledge topics with totals | - |
| `/memory-review` | Review all project knowledge and propose corrections, merges or removals for user validation | `memory-manager` |
| `/release` | Prepare and execute a release with explicit confirmation | - |
| `/review-changes` | Review uncommitted changes (staged, unstaged, untracked) | `code-reviewer` |
| `/review-pr <source> <target>` | Review diff from source branch into target branch | `code-reviewer` |
| `/send-to [agent] <message>` | Continue a child session using the native `subagent` tool | - |
| `/session-context [limit]` | Analyze context usage for recent sessions | - |
| `/simplify-changes` | Simplify uncommitted changes (staged, unstaged, untracked) | `code-simplifier` |
| `/task-board [list <status>\|done\|get <ID>]` | Show tasks as status columns without `done`, filter one status, or show one task | - |
| `/tests-coverage` | Run the full test suite with coverage report and suggest fixes for failures | `build` |

### /diff-summary

The `/diff-summary` command supports two modes:

**Working tree mode** (no parameters):
```bash
/diff-summary
```
Shows staged changes, unstaged changes, and untracked file contents.

**Branch comparison mode** (with parameters):
```bash
# Compare a branch with the current branch (HEAD)
/diff-summary feature-branch

# Compare two specific branches
/diff-summary feature-branch main
```
Shows stats overview, commits, files changed, and full diff between branches.

### /memory-review

Runs an on-demand global knowledge review in a `memory-manager` child session. It uses the
read-only `memory-review` inventory, then reads all entries with `knowledge list/get`.
The result is a coverage summary and reasoned proposals, not applied changes. The user must
validate proposals before a separate manager pass can apply them. Tasks are read only for
context or reference checks. See [Project memory](memory.md#on-demand-global-review).

### /memory, /task-board, /knowledge

Read-only inspection commands. Each calls one tool and returns its Markdown output unchanged:
the tool formats, the model only relays. They never save, note or remove memory and never create
or upgrade a missing store.

- `/memory` reports the store path, task counts by status and a knowledge topic inventory through
  the read-only `memory-overview` tool.
- `/task-board` shows every task except `done` as columns in the order `todo`, `in-progress`,
  `review`, `blocked`, with `ID — Title` cells; `list <status>` filters (including `done`, also
  available as bare `done`), and `get <ID>` shows one task with its progress notes.
- `/knowledge` lists topics, lists or searches entries, and `get <ID>` shows one entry.

Use `/memory-review` when the goal is to assess and propose changes, not merely to consult memory.

### /linear-stale-check

Analyzes open Linear issues for the team configured in `AGENTS.md` with:

```text
Linear team: <name>
```

If no team is configured, the command lists available Linear teams and asks which one to use for the current run.

The command is read-only. It fetches open issues, investigates related code, skips code investigation for issues already `In Progress`, and outputs a single report grouped by verdict:

- 🔴 Likely obsolete
- 🟡 Uncertain
- 🟢 Likely active

It does not modify Linear issues, add comments, or update project files.

---

## Skills

Skills are contextual instructions loaded on demand via the `skill` tool. The agent invokes `skill({ id: "skill-name" })` to load the instructions when needed.

### Overview

- Skills provide specialized guidance for specific tasks
- Instructions are loaded only when explicitly requested
- Multiple skills can exist with the same name; the highest-priority location wins

### Available Skills

| Skill | Description |
|-------|-------------|
| `ask-questions-if-underspecified` | Clarify requirements before implementing. Use when serious doubts arise. |
| `backlog-management` | Ticket responsibilities, proportionate tracking, and adaptive workflow through Linear/Trello MCP or Markdown. |
| `extreme-programming` | Shared XP values, simple evolving design, short feedback loops, and engineering responsibility. |
| `implementation-comparison` | Compare candidate implementations when the decision benefits from alternatives. |
| `tdd` | Short test/code/refactor loops and verification adapted to the change. |

#### Example: ask-questions-if-underspecified

**User request:**
> "Add authentication to the API"

**Agent response (after loading the skill):**

The agent recognizes this request has multiple interpretations and uses the `question` tool:

```
┌─ Authentication Approach ────────────────────────────────────────┐
│                                                                  │
│  Which authentication method should be implemented?              │
│                                                                  │
│  ○ JWT tokens (Recommended)                                      │
│  ○ Session-based with cookies                                    │
│  ○ OAuth 2.0 / OpenID Connect                                    │
│  ○ API keys                                                      │
│  ○ Other                                                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

After the user selects "JWT tokens", the agent confirms:

> "I'll add JWT-based authentication to the API endpoints using the existing Express middleware pattern. Success = all `/api/*` routes require a valid token, with a `/auth/login` endpoint for token generation."

Then implementation begins.

#### Example: tdd

**User request:**
> "Add a function to calculate the total price with tax"

**Agent response (after loading the skill):**

The agent follows the TDD workflow:

1. **Requirement Synthesis:**
> "I'll create a function that calculates total price with tax. It should accept a price and tax rate, returning the total."

2. **Red — test one behavior and run it to observe the expected failure:**
```typescript
describe("calculateTotalWithTax", () => {
  it("should add tax to the base price", () => {
    expect(calculateTotalWithTax(100, 0.2)).toBe(120)
  })
})
```

3. **Green — implement the minimum behavior and run the test again:**
```typescript
function calculateTotalWithTax(price: number, taxRate: number): number {
  return price * (1 + taxRate)
}
```

4. **Refactor:** simplify only where useful while preserving passing tests, then repeat for the next behavior (such as zero tax). Run relevant regression checks and report actual results. A pre-existing passing behavior needs verification, not an invented failure to manufacture a red phase.

### Discovery Locations

Skills are discovered from the following locations, in order of increasing priority:

| Priority | Scope | Location |
|----------|-------|----------|
| 1 (lowest) | plugin | `<plugin>/skill/` |
| 2 | global | `~/.config/opencode/skill/` |
| 3 (highest) | project | `<project>/.opencode/skill/` |

If multiple skills share the same name, the one from the highest-priority location takes precedence.

### Creating a Skill

Each skill lives in its own directory with a `SKILL.md` file:

```
skill/
└── my-skill/
    └── SKILL.md
```

The `SKILL.md` file uses YAML frontmatter for metadata:

```markdown
---
name: my-skill
description: Short description of the skill (required)
use_when: >
  Condition for automatic activation (optional).
---

# Detailed Instructions

Markdown content with step-by-step guidance...
```

#### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Identifier for the skill; defaults to the directory name |
| `description` | No | Short description (displayed in skill listings); may be empty |
| `use_when` | No | Condition for automatic activation |

A directory without `SKILL.md` is skipped. A `SKILL.md` without a `name` uses its directory name.

### Automatic Activation

If a skill defines `use_when`, a directive is injected into the system prompt:

```
MANDATORY: Call skill({ id: "my-skill" }) <use_when content>
```

This instructs the agent to load the skill when the specified condition is met.

**What is injected:**
- The skill `name`
- The `use_when` text (normalized: multiple spaces collapsed to single space)

**What is NOT injected:**
- The `description`
- The markdown content (loaded only when the skill is invoked)

---

## Utility tools

### gitingest

Fetch a GitHub repository's full content via gitingest.com. Returns summary, directory tree, and file contents optimized for LLM analysis. Use when you need to understand an external repository's structure or code.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | `string` | Yes | - | The GitHub repository URL to fetch |
| `maxFileSize` | `number` | No | `50000` | Maximum file size in bytes to include |
| `pattern` | `string` | No | `""` | Glob pattern to filter files (e.g., `*.ts`, `src/**/*.py`) |
| `patternType` | `"include"` \| `"exclude"` | No | `"exclude"` | Whether to include or exclude files matching the pattern |

#### Usage Examples

```typescript
// Fetch entire repository
gitingest({ url: "https://github.com/user/repo" })

// Only TypeScript files
gitingest({
  url: "https://github.com/user/repo",
  pattern: "*.ts",
  patternType: "include"
})

// Exclude test files
gitingest({
  url: "https://github.com/user/repo",
  pattern: "*.test.ts",
  patternType: "exclude"
})

// Increase max file size to 100KB
gitingest({
  url: "https://github.com/user/repo",
  maxFileSize: 100000
})
```

#### Limitations

- Content is truncated to 300k characters (server-side limit from gitingest.com)
- For large repositories, use pattern filtering to focus on relevant files
- The `maxFileSize` parameter controls individual file size, not total output size

---

### list-child-sessions

List persisted direct child sessions (subagents) for the current session, including children created before a plugin reload or service restart. Every call verifies that the CLI addresses the same service and reads all result pages, refreshing titles and timestamps. Children in other worktrees remain discoverable because the query filters by parent, not location. Use session IDs with recorded task and agent associations for native `subagent` follow-ups.

Successful discovery reports **verified** inventory, including an explicitly verified empty result. If discovery fails, a non-empty in-memory cache is reported as **incomplete**, with the error and a stale-metadata warning. Without cached children, the tool fails with **inventory unavailable**, never a false empty result. Failed pagination never publishes a partial page set as verified. The cache itself is not durable. This is session inventory, not live activity, background-tool ownership, or task completion.

#### Parameters

This tool takes no parameters.

#### Usage Examples

```typescript
// List all child sessions
listChildSessions()
```

#### Output

Returns a formatted list of child sessions with:
- Session ID
- Session title
- Created and updated timestamps

Example output:
```
Inventory verified from persisted sessions (all pages).
Child sessions (2):

1. [ses_abc123] Code Review Session
   Created: 2024-01-15T10:30:00Z | Updated: 2024-01-15T10:35:00Z

2. [ses_def456] Architecture Discussion
   Created: 2024-01-15T11:00:00Z | Updated: 2024-01-15T11:15:00Z
```

---

### session-context

Use `/session-context [limit]` to analyze the most recent sessions in the current project, including subagent sessions. The command calls the `session-context` tool and asks the agent to return its Markdown table and category list. Raw session messages are read inside the tool process and are never returned or copied into the discussion.

The `session-context` tool returns a Markdown table by default, so the agent can render it directly in its response. Its result contains only aggregated metrics; it never includes raw messages. The tool adds its small schema to the agent's tool catalog.

For each row the report includes the agent type, model and variant, active-context size after the last compaction, the model context limit and usage, the top tool by characters, cumulative session tokens and cost, and a character-based breakdown by category.

`Context` is the last assistant prompt (`input + cache.read + cache.write`), not cumulative session input. `Used` is `Context / model limit`. Category percentages are shares of active context characters after the last compaction; they are not token shares and exclude tool-schema/system overhead that is not present in messages. Attachments are counted separately and excluded from percentages. Context messages include `system`, `user`, `assistant`, `reasoning`, `tool calls`, `tool results`, `compaction` and `other` (shell).

The `Tools` table aggregates tool-call input and tool-result characters per tool name across the analyzed sessions. Its share is over all tool characters, so it answers which tools consume the active context. Tool parts without a name are reported as `(unnamed)`. The table lists the top 10 tools by characters.

Both read through the OpenCode API and do not start, stop, modify or compact a session. A context failure is reported on its row without hiding other sessions. If model limits are unavailable, rows still render with `n/a` usage. This is read-only reporting, not live activity or task completion.

#### Parameters

| Entry point | Parameter | Type | Required | Default | Description |
|-------------|-----------|------|----------|---------|-------------|
| `/session-context` | `limit` | `integer` | No | `10` | Positional argument, from 1 to 50 |
| `session-context` tool | `limit` | `integer` | No | `10` | Number of recent sessions to analyze, from 1 to 50 |
| `froggy-session-context` | `limit` | `integer` | No | `10` | Direct CLI argument, from 1 to 50 |
| `froggy-session-context` | `--markdown` | flag | No | text | Print the Markdown table instead of the aligned text report |

#### Usage Examples

```text
/session-context
/session-context 5
```

```bash
# Direct CLI, without going through the agent (requires Bun, the plugin runtime)
bun dist/cli/session-context.js 5
bun dist/cli/session-context.js --markdown 5

# After npm link or a global install
froggy-session-context --markdown 5
```

The slash command and tool do not require a separate CLI install. The direct CLI uses Bun, which is also the OpenCode plugin runtime.

#### Output

The tool returns a Markdown summary table followed by category and tool tables:

```markdown
| # | Session | Agent · Model | Context / Limit (used) | Top tool | Cost | Cumul session (in/out/cache) |
|---|---------|---------------|------------------------|----------|------|-------------------------------|
| 1 | Passe 7j… | memory-manager (sub) · deepseek/deepseek-flash#high | 242.5k / 1.00M (24.2%) | shell 220.9k | $2.58 | 6.18M / 1.38M / 112M |

### Categories

| # | Agent (kind) | Cost | reasoning | tool calls | tool results | system | compaction | assistant | user | other |
|---|--------------|------|-----------|------------|--------------|--------|------------|-----------|------|-------|
| 1 | memory-manager (sub) | $2.58 | 23.3% | 25.0% | 35.0% | 0.0% | 15.5% | 0.6% | 0.4% | 0.0% |
| **Global** | **all sessions** | **$2.58** | **23.3%** | **25.0%** | **35.0%** | **0.0%** | **15.5%** | **0.6%** | **0.4%** | **0.0%** |

### Tools

| Tool | Calls | Call chars | Result chars | Share of tool chars |
|---|---:|---:|---:|---:|
| shell | 120 | 40.1k | 220.9k | 52.0% |
```

`Context / Limit` is the last assistant prompt and its share of the model window. `Cumul session` is cumulative `input / output / cache read` for the whole session, separate from the active context. `Cost` is the session cost in USD. `Top tool` is the tool with the most characters in that session. The `Global` row shows the weighted category share across analyzed sessions and the total cost of the listed sessions.

---

### pdf-to-markdown

Convert a text-based PDF into enriched Markdown (headings, paragraphs, lists). Returns Markdown as plain text.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filePath` | `string` | Yes | - | Absolute path to the PDF file to convert |
| `maxPages` | `number` | No | All pages | Maximum number of pages to convert (positive integer) |

#### Usage Examples

```typescript
// Convert an entire PDF
pdfToMarkdown({ filePath: "/path/to/file.pdf" })

// Convert the first 3 pages
pdfToMarkdown({
  filePath: "/path/to/file.pdf",
  maxPages: 3
})
```

#### Notes

- The conversion extracts text content; image-only PDFs may return empty output.
- `maxPages` is capped at the document's total page count.

---

### agent-promote

Promote an agent to primary (default) or specify a grade.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Name of the plugin agent (e.g., `rubber-duck`, `architect`) |
| `grade` | `string` | No | Target type: `subagent`, `primary`, or `all` (default: `primary`) |

#### Grade Types

| Grade | Effect |
|-------|--------|
| `subagent` | Available only as a subagent |
| `primary` | Appears in Tab selection for direct use |
| `all` | Available both as primary and subagent |

#### Usage Examples

```bash
# Promote rubber-duck to primary (default)
/agent-promote rubber-duck

# Promote with explicit grade
/agent-promote architect all

# Demote back to subagent
/agent-demote rubber-duck
```

#### Notes

- Only agents from this plugin can be promoted (see the [Agents](../README.md#agents) table)
- Promotions and demotions are held only in memory for the current project's plugin instance (OpenCode location). Other projects and worktrees have independent instances; conversations in the same location share the mode.
- A registry refresh preserves the requested mode. Reloading the plugin or restarting OpenCode restores the modes defined in `agent/*.md`. Neither operation writes agent files or persistent promotion settings.
- The tool checks the effective mode after reloading. If a global/project agent definition or a later plugin overrides it, the tool reports the conflict instead of claiming success.

---

## Configuration

The plugin loads agents, commands, and skills automatically from the `agent/`, `command/`, and `skill/` directories. Hooks are loaded from the standard OpenCode configuration directories (see [Hooks](hooks.md)). The only tool-specific setting is the optional `ETHERSCAN_API_KEY` described in [Ethereum and EVM](ethereum.md#configuration); Etherscan-backed queries require it.

### Supported Code File Extensions

The `hasCodeChange` condition checks file extensions against the default set listed in the [Hooks conditions](hooks.md#conditions) section. Hooks without conditions run on every matching event; `hasCodeChange` is only needed to filter on modified code files. Tracked files come from `write`, `edit`, and `patch`.

---

## Related

- [Orchestration](orchestration.md)
- [Project memory](memory.md)
- [Ethereum and EVM tools](ethereum.md)
