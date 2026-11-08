<p align="center">
  <img src="images/logo.png" alt="opencode-froggy logo" width="300">
</p>

<p align="center">
  <a href="https://github.com/smartfrog/opencode-froggy/actions"><img src="https://github.com/smartfrog/opencode-froggy/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/opencode-froggy"><img src="https://badge.fury.io/js/opencode-froggy.svg" alt="npm version"></a>
</p>

# OpenCode Froggy

OpenCode Froggy brings **multi-agent delegation**, **durable project memory**, and **general-purpose tools** to OpenCode, guided by Extreme Programming.

**Clear objectives. Focused agents. Simple solutions. Verified results.**

## Quick start

### Install

Add the plugin to your OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-froggy"]
}
```

Requires OpenCode V2.

For local development, clone or copy the plugin into:

- **Project-local:** `.opencode/plugins/opencode-froggy/`
- **Global:** `~/.config/opencode/plugins/opencode-froggy/`

### Start working

1. Select the `orchestrator` agent for coordinated delivery, or `product-owner` when the product direction is still being shaped.
2. State the objective and the acceptance criteria you care about.
3. Let the orchestrator delegate bounded work, review it, and integrate verified results.

Project memory needs no separate service. All agents read canonical memory directly; only `memory-manager` writes tasks and knowledge, preserving the orchestrator's execution decisions.

## Documentation map

| Guide | Read it for |
|---|---|
| [Orchestration](docs/orchestration.md) | Agents, delegation, review, integration, workspaces, coordination loop, model pools |
| [Project memory](docs/memory.md) | Task board, knowledge, revisions, discovery, ownership, legacy Markdown, diagrams |
| [Reference](docs/reference.md) | Commands, skills, utility tools, configuration |

## Orchestration

The `product-owner` clarifies intent, scope, priorities, and acceptance before execution. The orchestrator then turns that objective into a sequence of bounded assignments: it decides what to do, chooses workers and models, requests independent review, and integrates only verified revisions.

```mermaid
flowchart LR
    U[Objective] --> O[Orchestrator]
    O --> W[Bounded workers]
    W --> R[Independent review]
    R --> I[Integrate and verify]
    I --> O
```

Workers return results, checks tied to an exact revision, blockers, and evidence paths. A non-trivial change set needs independent review before completion. Temporary workspaces are released only after every user, background process, branch, and recovery reference has been checked.

The optional [coordination loop](docs/orchestration.md#coordination-loop) keeps sustained work moving with a short periodic reminder.

## Project memory

Froggy separates **current execution state** from **durable knowledge**:

| Store | Purpose |
|---|---|
| `task-board` | Title, status and one current task description |
| `knowledge` | Valuable constraints, performance tips, pitfalls and decisions grouped by topic |

Both live in one SQLite database per canonical project, shared across worktrees. All agents may read; only `memory-manager` saves, edits, removes or restores records and creates verified backups. The orchestrator owns execution and acceptance decisions, sending IDs/fields, intended changes, facts and evidence to the manager. Draft text is allowed; reconstructing whole records is not required. Recovery retains only the current and immediately previous version, not a complete history.

Read only relevant context with `get`, knowledge `topics`/`list`/`search`, or literal body `grep` on one required ID. Tools return complete Markdown, but rendering may be truncated. Prefer guarded atomic `edit` for local body changes using sufficient relevant context; whole-field replacement still requires a FULL version-consistent read. If that is blocked, do not rewrite from excerpts. Do not load the whole store.

See [Project memory](docs/memory.md) for the model, curation rules, tools and upgrades. Utility tool parameters are in [Reference](docs/reference.md#utility-tools).

### task-board

Simple task tracking with `todo`, `in-progress`, `blocked`, `review` and `done`. All agents read with `list`/`get`/`grep`; only memory-manager can `save` or `edit`, using current `expectedVersion` for existing tasks. Descriptions are current syntheses, not histories. There are no task notes; only one previous version is retained for recovery.

### knowledge

Topic-organized durable knowledge. Use `list`, ranked full-text `search`, `get` and single-record literal `grep`. Large records support version-checked slices. The manager uses `save`, guarded exact-text `edit` or version-checked `remove`; only the last saved content survives removal, recoverable through `history` and `restore`. Irrelevant or duplicate knowledge may yield `No change`. Use an explicit verified `memory-backup` before broad curation: two successive changes replace the recovery buffer. Neither pruning nor removal securely erases SQLite pages or backups.

Group useful knowledge candidates in one bounded curation pass. Status, tests, reminders or review references alone do not warrant new knowledge; task changes still go through the manager. Search relevant knowledge for duplicates, clean only scoped redundancy/obsolete prose, and preserve facts, scope, negation, uncertainty, constraints and operator decisions. Capture explicit retention requests and important confirmed findings even while blocked; do not wait for done. No automatic global sweep.

Run `/memory-review` on demand for a global knowledge review. The read-only `memory-review` tool inventories topics; `memory-reviewer` reads all entries and proposes corrections, merges or removals for your validation. Nothing is applied during the review.

## Agents

| Agent | Mode | Description |
|---|---|---|
| `product-owner` | primary | Clarifies product intent, scope, priorities, and acceptance; produces an actionable backlog. |
| `orchestrator` | primary | Coordinates execution, delegates work, requests review, integrates verified results, and reports honestly. |
| `architect` | subagent | Strategic technical advisor for architecture and complex trade-offs. Read-only. |
| `doc-writer` | subagent | Technical writer for README, API, architecture, and user documentation. |
| `code-reviewer` | subagent | Independent review of correctness, regressions, security, and maintainability. |
| `code-simplifier` | subagent | Simplifies recently modified code while preserving behavior. |
| `memory-manager` | subagent | Sole task/knowledge writer; curates scoped changes, restores versions and creates verified backups. |
| `memory-reviewer` | subagent | Read-only knowledge audit; proposes changes without mutation, backup or delegation access. |
| `partner` | subagent | Strategic ideation partner that expands solution spaces. Read-only. |
| `rubber-duck` | subagent | Thinking partner that listens, reflects, and asks focused questions. Read-only. |

### orchestrator

The `orchestrator` owns execution and acceptance decisions, delegating all memory writes—including review/session/workspace references—to `memory-manager`. The manager reads required current context and verifies changes without silently changing those decisions. Handback is compact IDs, versions, outcome, meaningful refused/ambiguous items, blockers and next action, not full-record echoes or parent readback by default. See [Orchestration](docs/orchestration.md).

## Commands

| Command | Description | Agent |
|---|---|---|
| `/agent-promote <name> [grade]` | Promote an agent to primary (default), subagent, or all. | — |
| `/agent-demote <name>` | Demote an agent to subagent. | — |
| `/commit-push` | Stage, commit, and push changes with confirmation. | `build` |
| `/diff-summary [source] [target]` | Show working-tree changes or branch diffs. | — |
| `/doc-changes` | Update documentation for new uncommitted features. | `doc-writer` |
| `/gh-create-pr` | Commit, push, and create a GitHub pull request. | `build` |
| `/knowledge [list\|search\|get] ...` | Browse or search project knowledge without modifying it. | — |
| `/linear-stale-check` | Review open Linear issues for likely relevance. | `plan` |
| `/memory` | Show task counts by status and knowledge topics with totals. | — |
| `/memory-review` | Review all project knowledge and propose cleanup for user validation. | `memory-reviewer` |
| `/release` | Prepare and execute a release with explicit confirmation. | — |
| `/review-changes` | Review staged, unstaged, and untracked changes. | `code-reviewer` |
| `/review-pr <source> <target>` | Review a branch diff into a target branch. | `code-reviewer` |
| `/send-to [agent] <message>` | Continue a child session through the native subagent tool. | — |
| `/session-context [limit]` | Analyze context usage for recent sessions. | — |
| `/simplify-changes` | Simplify uncommitted changes. | `code-simplifier` |
| `/task-board [list <status>\|done\|get <ID>]` | Show tasks as status columns without `done`, filter one status, or show one task. | — |
| `/tests-coverage` | Run coverage and suggest fixes for failures. | `build` |

The `/memory`, `/task-board` and `/knowledge` commands call a tool that returns Markdown.
The tool does the formatting; the model only relays its output without reformatting it.

Selected command details are in [Reference](docs/reference.md#commands).

## Tools

| Domain | Tools | Guide |
|---|---|---|
| Memory | `memory-overview`, `task-board`, `knowledge`, `memory-review` | [Project memory](docs/memory.md) |
| Orchestration | `start-orchestrator-loop`, `stop-orchestrator-loop`, `orchestrator-status` | [Orchestration](docs/orchestration.md#coordination-loop) |
| Utilities | `gitingest`, `list-child-sessions`, `session-context`, `pdf-to-markdown`, `agent-promote` | [Reference](docs/reference.md#utility-tools) |

Session context reports are available through `/session-context` or its tool, in Markdown only; there is no standalone CLI.

## Configuration

The plugin loads agents, commands, and skills from its bundled directories.

Model pools are configured in the first existing file:

1. `.opencode/orchestrator.md` in the project;
2. `~/.config/opencode/orchestrator.md`.

```markdown
complex: provider/model-a#max, provider/model-b#xhigh
normal: provider/model-c
```

## License

MIT
