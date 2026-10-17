<p align="center">
  <img src="images/logo.png" alt="opencode-froggy logo" width="300">
</p>

<p align="center">
  <a href="https://github.com/smartfrog/opencode-froggy/actions"><img src="https://github.com/smartfrog/opencode-froggy/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/opencode-froggy"><img src="https://badge.fury.io/js/opencode-froggy.svg" alt="npm version"></a>
</p>

## Philosophy

OpenCode Froggy brings **multi-agent delegation and orchestration** to OpenCode, guided by **Extreme Programming (XP)**.

- **Delegate with purpose:** specialized agents handle focused tasks; the orchestrator coordinates them and validates the result.
- **Work in short feedback loops:** test, code, refactor, review, and integrate incrementally.
- **KISS:** choose the simplest solution that meets the need.
- **YAGNI:** build what is needed now, not what might be useful later.

**Clear objectives. Focused agents. Simple solutions. Verified results.**

## Keep orchestration moving

Delegation is only the start. The **orchestrator loop** periodically sends a short coordination check to the orchestrator. This prompts the orchestrator to check current work and blockers, coordinate pending reviews, update the backlog, release eligible temporary workspaces, and advance the next useful action without waiting for another user prompt.

The loop persists across plugin reloads and server restarts, with a configurable interval (10 minutes by default). It supports sustained multi-agent work—not just one round of delegation.

Reminders require the OpenCode server and plugin to be running. The orchestrator stops the loop when the objective is achieved or the user asks it to stop.

See [Orchestrator loop](#orchestrator-loop) for tools and configuration.

---

## Table of Contents

- [Philosophy](#philosophy)
- [Keep orchestration moving](#keep-orchestration-moving)
- [Installation](#installation)
- [Commands](#commands)
- [Agents](#agents)
- [Skills](#skills)
  - [Overview](#overview)
  - [Available Skills](#available-skills)
  - [Discovery Locations](#discovery-locations)
  - [Creating a Skill](#creating-a-skill)
  - [Automatic Activation](#automatic-activation)
- [Tools](#tools)
  - [gitingest](#gitingest)
  - [list-child-sessions](#list-child-sessions)
  - [Orchestrator loop](#orchestrator-loop)
  - [pdf-to-markdown](#pdf-to-markdown)
  - [agent-promote](#agent-promote)
  - [Blockchain](#blockchain)
    - [Configuration](#configuration)
    - [eth-transaction](#eth-transaction)
    - [eth-address-balance](#eth-address-balance)
    - [eth-address-txs](#eth-address-txs)
    - [eth-token-transfers](#eth-token-transfers)
- [Hooks](#hooks)
  - [Configuration Locations](#configuration-locations)
  - [Configuration File Format](#configuration-file-format)
  - [Supported Events](#supported-events)
  - [Conditions](#conditions)
  - [Supported Actions](#supported-actions)
  - [Execution Behavior](#execution-behavior)
  - [Example Hook Configurations](#example-hook-configurations)
- [Configuration Options](#configuration-options)
- [License](#license)

---

## Installation

### From npm (recommended)

Add the plugin to your OpenCode configuration file (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-froggy"]
}
```

Requires OpenCode V2.

### From local files

Alternatively, clone or copy the plugin files to one of these directories:

- **Project-local**: `.opencode/plugins/opencode-froggy/`
- **Global**: `~/.config/opencode/plugins/opencode-froggy/`

---

## Commands

| Command | Description | Agent |
|---------|-------------|-------|
| `/agent-promote <name> [grade]` | Promote an agent to primary (default) or specify grade: `subagent`, `primary`, `all` | - |
| `/agent-demote <name>` | Demote an agent to subagent | - |
| `/commit-push` | Stage, commit, and push changes with user confirmation | `build` |
| `/diff-summary [source] [target]` | Show working tree changes or diff between branches | - |
| `/doc-changes` | Update documentation based on uncommitted changes (new features only) | `doc-writer` |
| `/linear-stale-check` | Review open Linear issues for the configured team and report whether they are likely active, uncertain, or obsolete | `plan` |
| `/review-changes` | Review uncommitted changes (staged, unstaged, untracked) | `code-reviewer` |
| `/review-pr <source> <target>` | Review diff from source branch into target branch | `code-reviewer` |
| `/send-to [agent] <message>` | Continue a child session using the native `subagent` tool | - |
| `/simplify-changes` | Simplify uncommitted changes (staged, unstaged, untracked) | `code-simplifier` |
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

## Agents

| Agent | Mode | Description |
|-------|------|-------------|
| `product-owner` | primary | Challenges ideas, clarifies scope and priorities, and turns the user's intent into an actionable backlog. |
| `orchestrator` | primary | Autonomously coordinates sub-agents, adapts execution, and validates delivery against the user's objective. |
| `architect` | subagent | Strategic technical advisor providing high-leverage guidance on architecture, code structure, and complex engineering trade-offs. Read-only. |
| `doc-writer` | subagent | Technical writer that crafts clear, comprehensive documentation (README, API docs, architecture docs, user guides). |
| `code-reviewer` | subagent | Read-only code review agent for quality, correctness, security, and maintainability feedback. |
| `code-simplifier` | subagent | Simplifies recently modified code for clarity and maintainability while strictly preserving behavior. |
| `memory-manager` | subagent | Curates and writes delegated memory/ticket files through version-checked saves with verified archives and compact receipts. |
| `partner` | subagent | Strategic ideation partner that breaks frames, expands solution spaces, and surfaces non-obvious strategic options. Read-only. |
| `rubber-duck` | subagent | Rubber duck for thinking out loud. Listens, reflects, and asks gentle, focused questions to help users clarify their own ideas. Read-only. |

The `code-reviewer` permits common Git inspection commands, including tracked files, refs, history, and worktrees. Branch permissions cover bounded listing forms such as `git branch -r --sort=-committerdate` and `git branch --list -a --sort=-committerdate`; use `git for-each-ref` for advanced filtering and formatting. For tag and configuration queries, put the explicit read mode first: `git tag --list`, `git config get`, or `git config list`. Remote inspection uses `git remote`, `git remote -v`, `git remote get-url`, or `git remote show`. Select the repository with the shell tool's `workdir`.

### product-owner

A primary agent for turning ideas and existing analysis into useful product direction and an actionable backlog. It challenges unnecessary complexity, investigates known context, and keeps briefs and tickets proportionate to the work. Focused consultations with `explore` for discovery and `architect` for technical constraints help resolve consequential uncertainty when useful.

The product owner produces requested planning artifacts within the user's mandate, without a separate approval ceremony for already authorized work. It owns product intent and hands execution context to `orchestrator`, which may adjust technical ticket boundaries while preserving product commitments. See [product-owner](agent/product-owner.md) for guidance. Publishing a backlog does not itself authorize development.

### XP practices

The seven existing delivery and advisory agents other than `partner` use the shared `extreme-programming` skill according to their roles. It translates communication, simplicity, feedback, courage, and respect into practical rules. The `memory-manager` has a separate bounded writing/curation contract, without an exemption from required independent review. This adaptation uses independent implementation and review, without pair programming or a new developer agent.

- The existing `general` implementation worker uses **test → code → refactor** by default for features and bugfixes. When another verification is more appropriate, it reports the reason, alternative check, and result. The loop stays with the implementer.
- `architect` supports evolving design and revisable decisions. Research spikes have a question, investigation budget, and decision criterion.
- `code-reviewer` independently reviews every non-trivial change set before integration or completion, including configuration and agent instructions. It checks behavioral coverage and acceptance examples; passing tests or self-review do not replace it. `code-simplifier` provides targeted, tested improvements before delivery validation rather than mandatory final cleanup.
- `doc-writer` updates useful documentation alongside the increment; `rubber-duck` supports concrete examples and explicit assumptions while preserving its listening role.
- Integration is frequent and serialized, with combined-revision checks. Recover a failing integration baseline before adding more changes to it, while continuing independent work. Product outcomes are shown for user feedback; integrated does not mean deployed.

### Shared backlog workflow

Both primary agents use [backlog-management](skill/backlog-management/SKILL.md) with **one authoritative backlog**: the agreed project backend, or local **`.opencode/backlog/<ticket-id>.md`** by default. Linear/Trello MCP remains supported when selected; an existing tracker is not silently replaced. For local Markdown, record one authoritative directory in a retained checkout and share its absolute path with sessions in other worktrees instead of maintaining divergent copies.

Keep one short current snapshot per coherent deliverable: objective and acceptance, actual status, next action or blocker, applicable worker/session/branch/worktree/revision references, review disposition, and links to evidence. Do not create a ticket per worker, review, test, or trial, or turn tickets and coordination files into duplicate execution diaries. Preserve historical details in linked reports or archives before shortening records, keep recovery references discoverable, and update the parent outcome as work advances. Worker returns summarize results, checks, blockers, and evidence paths; follow-ups carry changed or missing context without dropping authorization or safety limits.

For an agreed backend migration, reconcile open work against actual sessions and evidence, preserve IDs, constraints and recovery/review references, and independently verify the migrated state before recording the new authority and stopping updates to the old backend. Keep the previous tracker accessible as history, not a synchronized second backlog. Unavailable trackers can have local notes explicitly pending reconciliation. These are agent instructions, not an automatic migration, synchronization service, or schema enforcement.

The suggested flow is **Todo → In progress → To review → To integrate → Done**, adapted to existing project statuses. Accepted reports bypass integration; Done reflects verified acceptance and, for code delivery, integrated results. Tickets contain only useful execution context and evidence.

Start small, usually with up to three active tickets or workers, and adapt parallelism to resources, independence, and project limits. Real dependencies and explicit sequencing govern readiness; priority alone does not block independent work. At startup, resume, or after compaction, recover relevant missing references and verify them against sessions and Git. Reuse available context and refresh affected work instead of rereading all reports or auditing the whole backlog for every task or periodic reminder.

### orchestrator

Renamed from `build-orchestrator`: update agent references to `orchestrator`. Inspect and remove the obsolete `build-orchestrator.md` from your global agents directory (normally `~/.config/opencode/agents/`) after preserving any customizations. Model configuration and memory paths remain `.opencode/orchestrator.md` and `.opencode/orchestrator/`.

Agents are registered directly from the plugin's `agent/` directory through `ctx.agent.transform()`. They are no longer copied into global configuration. On startup, matching legacy copies (including mode-only differences) are archived outside the agents directory in `~/.config/opencode/froggy-agent-backups/`. Different copies are left active and their paths reported in the plugin log: compare them and move obsolete copies out of the agents directory after preserving customizations. Global/project agent definitions take precedence over the plugin, including their modes and permissions.

A primary agent that owns execution decisions and delivers the user's objective through sub-agents. The [orchestrator guidance](agent/orchestrator.md) covers:

1. **Organize** useful execution units from the request and real dependencies.
2. **Prepare** suitable workspaces: isolation for parallel or conflicting work, a shared workspace when sequential execution preserves existing work.
3. **Delegate** with clear objectives, context, and expected evidence. The initial prompt requires each worker to move its own session to the assigned workspace and verify the workspace and expected Git revision before editing, building, testing, or running other mutating commands. Optional model comparisons load [implementation-comparison](skill/implementation-comparison/SKILL.md) on demand.
   - Each bounded assignment gets a new native `subagent` session with `background: true` and no `sessionID`. Reuse its recorded session and agent only for clarifications, corrections, synchronization, or validation of that specific deliverable. Sharing a role, model, repository, module, or overall objective is not enough to reuse a session.
4. **Validate and review** every non-trivial change set with an independent `code-reviewer` before integration or completion. This includes logic, behavior, configuration, and agent instructions; trivial typos and formatting-only changes may use direct checks. Start a fresh reviewer session for each independent change set and reuse it for that change set's corrections. Supply the full diff, acceptance criteria, and test evidence; resolve confirmed blocking findings and record their disposition. Substantive changes after review require follow-up review.
   - Checks attributed to a SHA require that exact revision without staged, unstaged, or untracked code, tests, or configuration affecting the result; verify the SHA and working-tree state before and after checks, using a clean validation worktree when needed.
5. **Integrate and finish** incrementally, tying check evidence to the exact delivery SHA and rerunning relevant checks after every synchronization, even without conflicts, before integration. Verify and record the integrated revision and its results. Preserve existing work and recover from regressions before adding changes to an affected baseline.

The orchestrator also owns the [workspace lifecycle](agent/orchestrator.md#workspace-lifecycle): release temporary worktrees after accepted deliveries/reports or when review/validation no longer needs them, and reconcile leftovers at startup, resume, periodic reminders, and closure. Verify that all workspace users and background work are finished, preserve branches and durable evidence/recovery copies, and move sessions to an existing checkout before removal. Unknown ownership/activity, unverified preservation, or unsafe removal behavior blocks cleanup; routine cleanup never forces removal. Track each workspace as active, retained with a reason/next step, or removed after verification. The plugin sends reminders, not automatic deletions based on child inactivity.

#### Autonomy and automatic mode

Routine technical choices, ticket adjustments, scheduling, and recovery need no renewed approval. The orchestrator adapts after failures rather than stopping at a fixed retry count, and keeps independent work moving. Review depth, parallelism, and planning depth adapt to the work; independent review remains required for non-trivial changes.

Irreversible, destructive, or costly actions need clear authorization, even within the objective; existing authorization needs no repeated confirmation. See the [orchestrator's autonomy guidance](agent/orchestrator.md#autonomy) for handling unresolved authorization in each mode.

With `orchestrator` selected, say **"Automatic mode"** to delegate remaining choices for the established objective without confirmation or clarification questions. This mode belongs only to the orchestrator; the product owner and workers do not inherit it. See the [automatic-mode guidance](agent/orchestrator.md#automatic-mode) for decision handling, scope, authorization, and blockers.

#### Memory

**`.opencode/orchestrator/learnings.md`** is optional project knowledge, not an execution journal. Its **5,000-character soft budget is not a truncation limit**: preserve unique constraints and unresolved safety limits beyond it with a concise reason. Keep reusable repo facts, corrections, failed approaches with their causes, source references and explicit uncertainty; replace superseded notes rather than duplicating instructions or backlog history. There is no automatic injection or background compaction.

Reuse facts already in context. At startup, resume, or after compaction, read only relevant missing notes or facts needing verification; search by topic or source before opening long notes or archives. Periodic reminders do not require rereading unchanged memory. Before shortening an oversized file, preserve and verify its complete text under `.opencode/orchestrator/archive/` and retain references to archived sources. Archives are historical evidence, not live instructions. Preserve unique user constraints and unresolved safety limits even if they exceed the target, explaining the exception. Coordinate writers, preserve concurrent edits, and verify saves with focused reads rather than printing the whole file. Shortening a file does not remove earlier reads from an existing session or guarantee that compaction retained every fact.

Status and delivery evidence live in the backlog, not memory. Active tickets also retain applicable execution references: each worker's assignment, agent and session ID, branch/worktree, last validated SHA with check commands and results, and next step or blocker. Review evidence includes the reviewer session, reviewed revision or diff, findings, and their disposition. On resume, verify these references against available sessions and Git state; `list-child-sessions` retrieves persisted direct children, marking cached fallback results incomplete when discovery fails. Inventory does not prove worker activity or assignment completion. Memory does not establish current state. There is no run ledger; backlog and memory edits are not automatically committed.

Follow the backlog skill's [conservation policy](skill/backlog-management/SKILL.md#conservation): local files survive a service restart, but this is not a backup. Record explicitly approved Git history, a verified external backup, or `local-only` alongside the authority path. Same-checkout archives and ignore rules do not protect against checkout/disk loss; no automatic backup, commit or ignore-rule change is performed. The isolated recovery tests use fresh Node processes, disk-backed fixture storage and simulated sessions/clock; they do not demonstrate a live OpenCode restart or model-driven recovery.

#### Memory manager

The bundled [memory-manager](agent/memory-manager.md) writes explicitly delegated local memory/ticket files. Its default permissions allow local discovery and `memory-file`, not native editing, shell, delegation or remote mutations. Use it at useful milestones with named supported files, facts/decisions and constraints, following the backlog skill's [exclusive ownership handoff](skill/backlog-management/SKILL.md#responsibilities-and-tickets), not on every reminder. No new timer or hook is added.

Its primary mission is useful, deduplicated, topic-organized knowledge adapted to the project, not merely translating or recording updates. Curated prose is in English; identifiers, paths, hashes and exact quotations remain verbatim. Operational status, assignments, build deliveries and planned runs stay in tickets rather than being copied into knowledge. Conflicting placement requests are reported, not silently followed or expanded into unrelated files. Historical archives remain unchanged.

`memory-file` is available only to the `memory-manager` agent. `read` returns content and SHA-256; `write` requires that `expectedHash` (null only when absent) and a current session identity. Targets are restricted to the canonical project's `.opencode/orchestrator/learnings.md` and direct `.opencode/backlog/*.md` files, excluding instruction files and symlinked paths. Check this before delegation: other authoritative paths and remote trackers remain coordinator-written, never silently migrated. Project-wide memory intentionally uses the canonical root across worktrees; loop scheduling belongs to its invoking plugin location. Changed existing files are archived byte-for-byte and verified before locked temporary-file/rename replacement, with source rechecks and saved-content verification. Receipts contain hashes and archive paths, not the full document. Unchanged writes are no-ops. No delete, force or archive-edit operation is exposed.

Reads and saved/unchanged write receipts include `bytes` (UTF-8), `characters` and `characterUnit: "unicode-code-points"`; these are not token or visual-grapheme counts. Only `learnings.md` also returns `budget` with `targetCharacters: 5000`, non-negative `remainingCharacters` and `excessCharacters`, and `hardLimit: false`. An absent knowledge file reports zero usage and the full remaining budget. Over-budget writes remain intact; tickets have no knowledge-budget restriction.

Assignment scope/exclusive handoff is a coordination rule, not a persisted access grant. Locks serialize cooperating writes but cannot prevent external-editor races. Each `.memory-lock` records the host PID, session ID and creation timestamp; contention reports its path, observed age, owner when readable and safe recovery instructions. Legacy, incomplete or unsafe lock metadata is reported as owner unavailable. No TTL or PID-only unlock is used: confirm the owning session/tool has stopped, inspect live files and archives, then the coordinator may remove only a verified abandoned lock. Interrupted jobs can leave partial per-file saves; there is no multi-file transaction or automatic crash recovery. Independent review remains required; receipts prove saved bytes, not semantic correctness. Shorter files do not erase earlier context. Agent configuration can override permissions, but tool identity/path checks remain.

The admission and single-home principles draw on [Hermes memory](https://github.com/NousResearch/hermes-agent/blob/e5eb6b36fe78eb012cefd1f5f436cd458411b8b3/website/docs/user-guide/features/memory.md) and [OMP's decision consolidator](https://github.com/can1357/oh-my-pi/blob/a536558dc21634462c1b2647676953204569779c/packages/coding-agent/src/prompts/memories/sharpshooter-consolidate-system.md). Froggy does not import their storage engines, automatic review forks, or full-file rewrite tools; source and recovery references remain necessary for coding tickets.

#### Periodic coordination

For sustained background work, the orchestrator can activate a [persistent coordination loop](#orchestrator-loop). Every ten minutes by default, it receives a short, fixed steering reminder to check activity, results, reviews, blockers, backlog updates, and workspace cleanup. The orchestrator inspects current state as needed, resumes workers only for their original assignments, and starts fresh sessions for independent work. It stops the loop when the objective is achieved or the user requests it.

#### Model configuration

Models are configured in `orchestrator.md`, loaded from the first location that exists: `.opencode/orchestrator.md` in the project, then `~/.config/opencode/orchestrator.md`. The whole file is the configuration:

```markdown
complex: provider/model-a#max, provider/model-b#xhigh
normal: provider/model-c
```

- A model reference is `provider/model`, optionally suffixed with a variant (`#max`, `#xhigh`).
- Each level is a comma-separated **pool of models**. Round-robin is the default; the orchestrator may choose another configured model when useful. See [implementation-comparison](skill/implementation-comparison/SKILL.md) for alternative evaluation.
- `complex` / `normal` apply across ticket kinds; reviewers and simplifiers default to the orchestrator's session model.
- Fallbacks: missing `complex` → `normal`; missing `normal` or no config file → the session model without an explicit override.
- Commit the project file to enforce a team standard, or gitignore it for personal model preferences.

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
| `name` | Yes | Unique identifier for the skill |
| `description` | Yes | Short description (displayed in skill listings) |
| `use_when` | No | Condition for automatic activation |

A skill without `name` or `description` will be ignored.

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

## Tools

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

### Orchestrator loop

`start-orchestrator-loop` enables or updates one persistent reminder loop for the current **root orchestrator session**. `stop-orchestrator-loop` disables that session's loop and cancels its still-pending reminders. The stop tool can also be used after switching the session to another agent.

`orchestrator-status` inspects the current session without starting/stopping the loop, waking execution, changing cadence, or writing storage. It works after switching agents too.

#### Parameters

| Tool | Parameter | Type | Required | Default | Description |
|------|-----------|------|----------|---------|-------------|
| `start-orchestrator-loop` | `objective` | `string` | Yes | - | The user's established objective |
| `start-orchestrator-loop` | `intervalMinutes` | `integer` | No | `10` | Reminder interval, from 1 to 35791 minutes (the timer's supported range) |
| `stop-orchestrator-loop` | - | - | - | - | Uses the current session; takes no parameters |
| `orchestrator-status` | - | - | - | - | Read-only status for the current session; takes no parameters |

Example tool arguments:

```json
{
  "objective": "Complete the agreed implementation and validate its acceptance criteria",
  "intervalMinutes": 10
}
```

#### Behavior

- A new or changed loop first reminds after one interval. Repeating normalized settings at the same location is a no-op: it preserves the original deadline, revision, and pending/in-flight reminder. Calling start after a reload reactivates the persisted cadence if necessary. Changed settings or location replace the loop and cancel obsolete pending reminders.
- Reminders use `steer`, including when the orchestrator is active. Delivery happens at a step boundary; a running model request or tool may delay it.
- At most one reminder for the loop remains in the session inbox. Later intervals resume that same synthetic input by ID instead of accumulating messages, including after a reload or a failed wake attempt. Obsolete pending reminder text is replaced at the next interval.
- Each reminder is a fixed, short coordination check. It asks the orchestrator to check current worker/background activity, new results, pending reviews, and blockers, reconcile meaningful backlog changes and verify saved updates, release eligible temporary workspaces, and advance useful work. The loop does not fetch or inject child/shell inventories or repeat the stored objective.
- The orchestrator decides what to resume or create toward the objective, using native `subagent` notifications for those executions.
- Workspace cleanup follows the orchestrator's workspace lifecycle, including verification and backlog records of removals or retention reasons. The reminder itself does not authorize removal.
- There is no total-duration cutoff. Transient delivery failures are logged and retried at the next interval.
- Settings are stored in OpenCode's plugin storage. Reloading the owning location's plugin restores the loop at its next future interval; missed intervals are skipped. The server and that plugin instance must be running to send reminders.
- Each loop belongs to the plugin location that started it, preventing other loaded worktrees from scheduling duplicate reminders. Reminders pause while a different agent is selected in the target session.
- Stopping removes the persisted configuration, waits for an in-flight reminder attempt even when invoked from another loaded location, and cancels reminders still in the inbox. Already delivered inputs and running worker tasks are not interrupted. Deleting the session removes its loop; plugin cleanup stops timers while retaining enabled configurations for reload.

The `opencode` CLI must be on the server's `PATH` and connect to the same OpenCode service. The plugin checks the target session's identity before using `opencode api` for inbox operations that the plugin SDK does not expose. API calls have a 30-second request timeout; this is not a limit on the loop's lifetime.

#### Status and diagnostics

`orchestrator-status` returns JSON with:
- `enabled`, `objective`, `intervalMinutes`, `ownerDirectory`, and the current `selectedAgent`.
- `state`: `disabled`, `scheduled`, `paused`, `not-loaded-here`, or `unknown` when session inspection fails; `suspensionReason` explains agent/parent restrictions.
- `scheduler.loadedHere` and `scheduler.nextCheckAt` (epoch milliseconds, or null). This is the local timer's next coordination check, not a guaranteed reminder delivery. A different location's stored configuration does not prove its scheduler is loaded there.
- `pending`: verified reminder IDs, or an explicit unavailable state and inspection error.
- `diagnostics`: last known reminder admission, successful wake request, and delivery error with timestamps. `lastError` remains historical after a successful retry; compare timestamps. Admission and wake requests do not prove that the model processed the reminder or advanced any ticket.

Delivery diagnostics use separate, revision-scoped plugin storage and survive plugin reloads alongside enabled settings. They are not an operational backlog. Changing settings/location starts a fresh diagnostic scope; stopping or deleting a loop clears its diagnostics. Diagnostic saves and startup cleanup run independently of core scheduling: slow or failed diagnostic I/O does not prevent enablement, reconfiguration or subsequent wakes, including during overlapping reloads. Writes and cleanup are serialized separately across plugin locations; changes during a pending save are coalesced. Persistence and status merge each event by observation timestamp, retaining the saved observation on ties, so late older snapshots do not replace newer diagnostics. Stop cancels pending reminders before draining diagnostic writes/cleanup. Graceful plugin cleanup flushes buffered observations and drains dynamically spawned writes while keeping scheduling disabled; failed saves remain best-effort, not a crash-recovery guarantee.

Diagnostic persistence failures are logged and exposed as `persistenceError` while that runtime remains loaded, with unsaved observations retried at later checks. `persistencePending` indicates queued/in-flight diagnostic I/O; `readError` exposes malformed or unreadable diagnostic storage. Unsaved diagnostics cannot be guaranteed after a process exit. Status is a point-in-time observation, not an atomic snapshot of session, inbox and timer state.

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

- Only agents from this plugin can be promoted (see [Agents](#agents) table)
- Promotions and demotions are held only in memory for the current project's plugin instance (OpenCode location). Other projects and worktrees have independent instances; conversations in the same location share the mode.
- A registry refresh preserves the requested mode. Reloading the plugin or restarting OpenCode restores the modes defined in `agent/*.md`. Neither operation writes agent files or persistent promotion settings.
- The tool checks the effective mode after reloading. If a global/project agent definition or a later plugin overrides it, the tool reports the conflict instead of claiming success.

---

### Blockchain

Tools for querying Ethereum and EVM-compatible blockchains via Etherscan APIs.

All blockchain tools support multiple chains via the `chainId` parameter:

| Chain ID | Network |
|----------|---------|
| `1` | Ethereum (default) |
| `137` | Polygon |
| `56` | BSC |
| `42161` | Arbitrum |
| `10` | Optimism |
| `8453` | Base |
| `43114` | Avalanche |
| `250` | Fantom |
| `324` | zkSync |

#### Configuration

The blockchain tools use Etherscan-compatible APIs. An API key is optional but recommended.

**Environment Variable:**

| Variable | Required | Description |
|----------|----------|-------------|
| `ETHERSCAN_API_KEY` | No | API key for Etherscan and compatible explorers |

**Without an API key:** Requests are rate-limited (typically 1 request per 5 seconds).

**With an API key:** Higher rate limits and more reliable access.

**Getting an API key:**

1. Create a free account at [etherscan.io](https://etherscan.io/register)
2. Navigate to API Keys in your account settings
3. Generate a new API key

**Setting the environment variable:**

```bash
export ETHERSCAN_API_KEY="your-api-key-here"
```

#### eth-transaction

Get Ethereum transaction details by transaction hash. Returns status, block, addresses, gas costs in JSON format. Use optional parameters to include internal transactions, token transfers, and decoded event logs.

##### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `hash` | `string` | Yes | - | Transaction hash (0x...) |
| `chainId` | `string` | No | `"1"` | Chain ID (see table above) |
| `includeInternalTxs` | `boolean` | No | `false` | Include internal transactions (ETH transfers between contracts) |
| `includeTokenTransfers` | `boolean` | No | `false` | Include ERC-20 token transfers |
| `decodeLogs` | `boolean` | No | `false` | Decode event logs (Transfer, Approval, Deposit, Withdrawal) |

##### Usage Examples

```typescript
// Get basic transaction details on Ethereum mainnet
ethTransaction({ hash: "0x123abc..." })

// Get transaction on Polygon
ethTransaction({ 
  hash: "0x123abc...",
  chainId: "137"
})

// Get transaction with internal transactions and token transfers
ethTransaction({ 
  hash: "0x123abc...",
  includeInternalTxs: true,
  includeTokenTransfers: true
})

// Get full transaction details with decoded event logs
ethTransaction({ 
  hash: "0x123abc...",
  includeInternalTxs: true,
  includeTokenTransfers: true,
  decodeLogs: true
})
```

##### Output Structure

The tool returns JSON with labeled addresses (contract names resolved via Etherscan):

```json
{
  "hash": "0x123...",
  "status": "success",
  "block": 12345678,
  "from": { "address": "0xabc...", "label": "Uniswap V3: Router" },
  "to": { "address": "0xdef...", "label": "WETH" },
  "value": "0",
  "gas": { "used": 150000, "price": "20000000000", "cost": "0.003" }
}
```

With `includeInternalTxs: true`:
```json
{
  "internalTransactions": [
    {
      "from": { "address": "0x...", "label": "Uniswap V3: Router" },
      "to": { "address": "0x...", "label": null },
      "value": "1.5",
      "type": "call"
    }
  ]
}
```

With `includeTokenTransfers: true`:
```json
{
  "tokenTransfers": [
    {
      "token": { "address": "0x...", "name": "Wrapped Ether", "symbol": "WETH", "decimals": 18 },
      "from": { "address": "0x...", "label": null },
      "to": { "address": "0x...", "label": "Uniswap V3: Router" },
      "value": "1.5"
    }
  ]
}
```

With `decodeLogs: true`:
```json
{
  "decodedEvents": [
    {
      "name": "Transfer",
      "address": { "address": "0x...", "label": "WETH" },
      "params": { "from": "0x...", "to": "0x...", "value": "1500000000000000000" }
    }
  ],
  "undecodedEventsCount": 2
}
```

##### Supported Decoded Events

| Event | Description |
|-------|-------------|
| `Transfer` | ERC-20 token transfer |
| `Approval` | ERC-20 approval for spending |
| `Deposit` | WETH deposit (ETH → WETH) |
| `Withdrawal` | WETH withdrawal (WETH → ETH) |

#### eth-address-balance

Get the ETH balance of an Ethereum address. Returns balance in both ETH and Wei.

##### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `address` | `string` | Yes | - | Ethereum address (0x...) |
| `chainId` | `string` | No | `"1"` | Chain ID (see table above) |

##### Usage Examples

```typescript
// Get balance on Ethereum mainnet
ethAddressBalance({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" })

// Get balance on Arbitrum
ethAddressBalance({ 
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  chainId: "42161"
})
```

#### eth-address-txs

List Ethereum transactions for an address. Shows incoming and outgoing transactions with values, timestamps, and status.

##### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `address` | `string` | Yes | - | Ethereum address (0x...) |
| `limit` | `number` | No | `20` | Maximum number of transactions to return |
| `chainId` | `string` | No | `"1"` | Chain ID (see table above) |

##### Usage Examples

```typescript
// List recent transactions on Ethereum mainnet
ethAddressTxs({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" })

// List last 50 transactions on Base
ethAddressTxs({ 
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  limit: 50,
  chainId: "8453"
})
```

#### eth-token-transfers

List ERC-20 token transfers for an Ethereum address. Shows token names, symbols, values, and transaction details.

##### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `address` | `string` | Yes | - | Ethereum address (0x...) |
| `limit` | `number` | No | `20` | Maximum number of transfers to return |
| `chainId` | `string` | No | `"1"` | Chain ID (see table above) |

##### Usage Examples

```typescript
// List recent token transfers on Ethereum mainnet
ethTokenTransfers({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" })

// List last 100 token transfers on Optimism
ethTokenTransfers({ 
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  limit: 100,
  chainId: "10"
})
```

---

## Hooks

Hooks run actions on session events. Configuration is loaded from standard OpenCode configuration directories.

### Configuration Locations

Hooks are loaded from these locations (in order, merged together):

| Platform | Global | Project |
|----------|--------|---------|
| Linux | `~/.config/opencode/hook/hooks.md` | `<project>/.opencode/hook/hooks.md` |
| macOS | `~/.config/opencode/hook/hooks.md` | `<project>/.opencode/hook/hooks.md` |
| Windows | `~/.config/opencode/hook/hooks.md` or `%APPDATA%/opencode/hook/hooks.md` | `<project>/.opencode/hook/hooks.md` |

On Windows, `~/.config` is preferred for cross-platform consistency. If hooks exist in `%APPDATA%` but not in `~/.config`, the `%APPDATA%` location is used.

Global hooks run first, then project hooks are added. Hooks from both sources are combined (not overridden).

### Configuration File Format

- YAML frontmatter must include a `hooks` list
- Each hook defines `event`, `actions`, and optional `conditions`
- Hooks for the same event run in declaration order

Example `hooks.md`:

```markdown
---
hooks:
  - event: session.idle
    conditions: [hasCodeChange, isMainSession]
    actions:
      - command: simplify-changes
---
```

### Supported Events

| Event | Description |
|-------|-------------|
| `session.idle` | Emitted when a session becomes idle and has files modified via `write` or `edit` in that session |
| `session.created` | Emitted when a session is created |
| `session.deleted` | Emitted when a session is deleted |
| `tool.before.*` | Emitted before any tool executes. Exit code 2 blocks the tool. |
| `tool.before.<name>` | Emitted before a specific tool (e.g., `tool.before.write`). Exit code 2 blocks the tool. |
| `tool.after.*` | Emitted after any tool executes |
| `tool.after.<name>` | Emitted after a specific tool (e.g., `tool.after.edit`) |

#### Tool Hook Execution Order

1. `tool.before.*` (all tools)
2. `tool.before.<name>` (specific tool)
3. *(tool executes)*
4. `tool.after.*` (all tools)
5. `tool.after.<name>` (specific tool)

#### Blocking Tools with Exit Code 2

For `tool.before.*` and `tool.before.<name>` hooks, a bash action returning exit code 2 will block the tool from executing. The stderr output is displayed to the user as the block reason.

### Conditions

| Condition | Description |
|-----------|-------------|
| `isMainSession` | Run only for the main session (not sub-sessions) |
| `hasCodeChange` | Run only if at least one modified file looks like code |

All listed conditions must pass for the hook to run.

**Code extensions treated as "code":**

`ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `json`, `yml`, `yaml`, `toml`, `css`, `scss`, `sass`, `less`, `html`, `vue`, `svelte`, `go`, `rs`, `c`, `h`, `cpp`, `cc`, `cxx`, `hpp`, `java`, `py`, `rb`, `php`, `sh`, `bash`, `kt`, `kts`, `swift`, `m`, `mm`, `cs`, `fs`, `scala`, `clj`, `hs`, `lua`.

### Supported Actions

#### Command Action

Execute a plugin command.

```yaml
# Short form
- command: simplify-changes

# With arguments
- command:
    name: review-pr
    args: "main feature"
```

If the command exists in config, the plugin reuses its `agent` and `model`.

#### Tool Action

Prompt the session to use a tool with specific arguments.

```yaml
- tool:
    name: bash
    args: { command: "echo done" }
```

#### Bash Action

Execute a shell command directly without involving the LLM. Useful for running linters, formatters, build scripts, or custom automation.

**Configuration:**

```yaml
# Short form
- bash: "npm run lint"

# Long form with custom timeout
- bash:
    command: "$OPENCODE_PROJECT_DIR/.opencode/hooks/init.sh"
    timeout: 30000  # milliseconds (default: 60000)
```

**Environment Variables:**

The plugin injects these variables into the child process environment:

| Variable | Value | Use case |
|----------|-------|----------|
| `OPENCODE_PROJECT_DIR` | Absolute path to the project (e.g., `/home/user/project`) | Reference project files from scripts located elsewhere |
| `OPENCODE_SESSION_ID` | The OpenCode session identifier | Logging, tracing, or conditioning actions based on session |

**Stdin JSON Context:**

The command receives a JSON object via stdin with session context:

```json
{
  "session_id": "abc123",
  "event": "session.idle",
  "cwd": "/path/to/project",
  "files": ["src/index.ts", "src/utils.ts"]
}
```

The `files` array is only present for `session.idle` events and contains paths modified via `write` or `edit`.

For tool hooks (`tool.before.*`, `tool.after.*`), additional fields are provided:

```json
{
  "session_id": "abc123",
  "event": "tool.before.write",
  "cwd": "/path/to/project",
  "tool_name": "write",
  "tool_args": { "filePath": "src/index.ts", "content": "..." }
}
```

**Environment Variables vs Stdin JSON:**

- **Environment variables**: Direct access via `$VAR`, convenient for simple values like paths and IDs
- **Stdin JSON**: Contains richer context (event type, working directory, modified files), requires parsing with `jq` or similar

Both mechanisms are complementary. Use environment variables for quick access to project path and session ID; use stdin JSON when you need event details or the list of modified files.

**Exit Codes:**

| Code | Behavior |
|------|----------|
| `0` | Success, continue to next action |
| `2` | Blocking error, stop remaining actions in this hook |
| Other | Non-blocking error, log warning and continue |

**Result Feedback:**

Bash hook results are automatically sent back to your session:

```
[BASH HOOK ✓] npm run lint
Exit: 0 | Duration: 1234ms
Stdout: All files passed linting
```

The feedback includes a status icon (✓ success, ✗ failure), exit code, execution duration, and stdout/stderr output (truncated to 500 characters). This message appears in your session but does not trigger a response from the assistant.

### Execution Behavior

- Action errors are logged and do not stop later actions
- `session.idle` only fires if files were modified via `write` or `edit`; the session's modified file list is cleared after the hook runs
- The main session is set on `session.created` with no parent, or on the first `session.idle` if needed

### Example Hook Configurations

#### Basic Multi-Hook Setup

```markdown
---
hooks:
  - event: session.idle
    conditions: [hasCodeChange, isMainSession]
    actions:
      - bash: "npm run lint --fix"
      - command: simplify-changes

  - event: session.created
    actions:
      - bash:
          command: "$OPENCODE_PROJECT_DIR/.opencode/hooks/init.sh"
          timeout: 30000
      - command:
          name: review-pr
          args: "main feature"
---
```

#### Simple Lint-on-Idle Hook

```yaml
hooks:
  - event: session.idle
    conditions: [hasCodeChange]
    actions:
      - bash: "npm run lint --fix"
```

#### Custom Initialization Script

`.opencode/hooks/init.sh`:

```bash
#!/bin/bash
set -e

# Read JSON context from stdin
context=$(cat)
session_id=$(echo "$context" | jq -r '.session_id')
event=$(echo "$context" | jq -r '.event')
cwd=$(echo "$context" | jq -r '.cwd')

echo "Session $session_id triggered $event in $cwd"

# Use environment variables
echo "Project: $OPENCODE_PROJECT_DIR"

# Exit 0 for success, 2 to block remaining actions
exit 0
```

#### Conditional Blocking Based on Lint Errors

```bash
#!/bin/bash
# Run linter and block if critical errors found
if ! npm run lint 2>&1 | grep -q "critical"; then
  exit 0  # Success, continue
else
  echo "Critical lint errors found, blocking further actions"
  exit 2  # Block remaining actions
fi
```

#### Block Modifications to Sensitive Files

```yaml
hooks:
  - event: tool.before.write
    actions:
      - bash: |
          file=$(cat | jq -r '.tool_args.filePath // .tool_args.file_path // .tool_args.path')
          if echo "$file" | grep -qE '\.(env|pem|key)$'; then
            echo "Cannot modify sensitive files: $file" >&2
            exit 2
          fi

  - event: tool.before.edit
    actions:
      - bash: |
          file=$(cat | jq -r '.tool_args.filePath // .tool_args.file_path // .tool_args.path')
          if echo "$file" | grep -qE '\.(env|pem|key)$'; then
            echo "Cannot modify sensitive files: $file" >&2
            exit 2
          fi
```

#### Auto-Format TypeScript Files After Write

```yaml
hooks:
  - event: tool.after.write
    actions:
      - bash: |
          file=$(cat | jq -r '.tool_args.filePath // .tool_args.file_path // .tool_args.path')
          if echo "$file" | grep -qE '\.tsx?$'; then
            npx prettier --write "$file"
          fi
```

#### Log All Tool Executions

```yaml
hooks:
  - event: tool.before.*
    actions:
      - bash: |
          context=$(cat)
          tool=$(echo "$context" | jq -r '.tool_name')
          echo "[$(date)] Tool: $tool" >> /tmp/opencode-tools.log
```

---

## Configuration Options

The plugin does not require additional configuration. Agents, commands, and skills are loaded automatically from the `agent/`, `command/`, and `skill/` directories within the plugin. Hooks are loaded from the standard OpenCode configuration directories (see [Hooks](#hooks) section).

### Supported Code File Extensions

The `hasCodeChange` condition checks file extensions against the default set listed in the [Conditions](#conditions) section. Hooks without any conditions still trigger on any modified file paths tracked via `write` or `edit` in the current session.

---

## License

MIT
