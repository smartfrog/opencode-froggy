# Changelog

## Unreleased

## 1.6.2
- Remove task progress notes and the `note` action; keep one current task description and durable knowledge, without a new migration or rewriting existing databases
- Simplify memory-manager and orchestrator memory/delegation guidance; replace obsolete state instead of accumulating update histories

## 1.6.1
- Keep memory reads complete without display-driven size limits; preserve topic filters on knowledge searches and read each task with its notes from one database snapshot
- Return Markdown from every `task-board`, `knowledge` and `memory-overview` read, so `/memory`, `/task-board` and `/knowledge` relay one tool output instead of reformatting JSON; writes still return JSON receipts and task boards use status columns excluding `done` by default
- Add a read-only `memory-overview` tool for store path, task counts and knowledge topics, keeping `/memory` and `/knowledge` separate from the `memory-review` cleanup audit
- Keep `task-board` and `knowledge` reads read-only, so inspection never creates or upgrades a store; schema upgrades now happen on the first write

## 1.6.0
- Add read-only `memory-review` topic inventory and `/memory-review` for an on-demand global knowledge review by memory-manager; report proposals and coverage before user validation, without automatically modifying memory or migrating a store
- Simplify project memory to task title/status/description, short progress notes, and topic-organized knowledge; remove structured history, field ranges, knowledge kinds and supersession metadata
- Make `memory-manager` the knowledge curator: it decides what to retain, correct, merge, refuse or permanently delete; mutations use version checks and reads use simple bounded pages
- Back up and transactionally convert the previous SQLite schema on first access, preserving task details and source links; retain migration backups without automatic cleanup
- Remove the `memory-file` tool and Markdown backend compatibility; existing project Markdown files are not automatically imported or deleted
- Reorganize documentation into a concise README hub with dedicated guides for orchestration, project memory, Ethereum/EVM tools, hooks, and reference material
- Replace npm, Node and Vitest with Bun for installs, scripts, tests, CI and the lockfile; publication keeps npm only for OIDC provenance
- Add a per-project SQLite coordination store at `.opencode/memory/memory.db`, shared across canonical-project worktrees; all agents read and only `memory-manager` writes
- Reject memory directories, database files and sidecars that escape the canonical project through symbolic links or unsafe hard links
- Add `/session-context` and a read-only `session-context` tool for recent project sessions, including subagents: Markdown table with agent/model, active context size, model-window usage, top tool, cumulative tokens/cost and character shares by category; only aggregated results are returned, never raw session messages
- Add a per-tool character breakdown to `session-context`, separating call input from result output so oversized shell, read or memory payloads are visible without ad-hoc scripts
- Add orchestrator tool discipline and a compact worker return contract to reduce tool round trips and oversized handbacks
- Remove `code-reviewer` permission restrictions and document that its read-only behavior is no longer enforced

## 1.5.0
- Retrieve persisted direct child sessions across reloads with full pagination and refreshed metadata; distinguish verified inventory, incomplete cached fallback and unavailable discovery
- Add read-only `orchestrator-status` for settings, local scheduling, pending reminders and revision-scoped persisted delivery diagnostics, without claiming reminder processing or task progress
- Define memory-manager's primary mission as useful, deduplicated, topic-organized English knowledge adapted to the project; keep operational state in tickets, report placement conflicts, and preserve literals, uncertainty and archives
- Report UTF-8 bytes and Unicode code-point usage in `memory-file` reads and saved/unchanged receipts; expose the 5,000-character knowledge target, remaining capacity and excess without rejecting writes or applying that budget to tickets
- Preserve cadence, revision and pending/in-flight reminders when `start-orchestrator-loop` receives unchanged settings at the same location; restore persisted schedules without resetting their deadlines
- Identify memory-lock owners by session/process and timestamp, report lock age/path and safe recovery instructions, and test isolated process recovery/crash scenarios with a strictly typechecked TypeScript fixture and no automatic unlocks
- Align memory-manager delegation with canonical-project paths and document local-only versus backed-up conservation; keep the memory size budget explicitly soft
- Add an on-demand `memory-manager` writer for delegated local notes/tickets, using a scoped `memory-file` tool with source-hash checks, verified original archives, locked atomic replacement and saved-content receipts; no new hooks or loop
- Keep orchestrator memory short and source-linked, separate durable knowledge from execution history, and prefer targeted reads with verified archival before shortening oversized notes
- Use one authoritative backlog with concise current-state tickets, a shared local Markdown location across worktrees, verified backend migrations, and compact worker handoffs without weakening evidence or safety checks

## 1.4.2
- Replace verbose orchestrator reminders with a fixed coordination check covering activity, reviews, blockers, backlog updates, and workspace cleanup; remove automatic child/shell snapshots and replace obsolete pending reminders after reload
- Breaking change: remove the `prompt-session` tool and its polling-based completion notifications; use native `subagent` follow-ups with `sessionID`, the original `agent`, and `background: true`
- Migrate `/send-to` and orchestrator guidance to native follow-ups; deferred messages must be sent after the current execution completes instead of using `delivery: "queue"`
- Scope child sessions to bounded assignments: start native `subagent` calls without `sessionID` for independent work, and reuse sessions only for their original deliverable's follow-ups
- Standardize child session titles with the agent, model, and ticket or assignment
- Require independent `code-reviewer` review before integrating or completing non-trivial changes, with fresh reviewer sessions per change set, correction follow-ups, and review evidence in the existing backlog
- Reinforce backlog maintenance at meaningful transitions and before completion, with verification that updates were saved
- Release temporary worktrees incrementally after accepted deliveries and reports, preserving branches, evidence, and recoverable sessions; track cleanup outcomes and reconcile retained workspaces
- Allow `pwd` and `git branch --show-current` in `code-reviewer` so workspace and branch inspection can run without shell permission failures
- Expand `code-reviewer` Git inspection permissions for files, refs, worktrees, bounded branch listings, and explicit read modes for tags, remotes, and configuration
- Clarify the project's XP, KISS, and YAGNI philosophy and highlight the persistent orchestrator loop in the README

## 1.4.1
- Fix orchestrator reminders failing to wake idle sessions with HTTP 409 by resuming the same synthetic input instead of changing an already-steered inbox item to `steer`
- Preserve child activity from accessible worktrees when another location cannot be inspected, reporting its shell activity as unknown while retaining shell ownership across session moves

## 1.4.0
- Add persistent `start-orchestrator-loop` and `stop-orchestrator-loop` tools for ten-minute coordination reminders, with steering delivery, live child/shell activity, pending-reminder coalescing, and reload recovery
- Prefer native `subagent` follow-ups with recorded task, agent, and session associations; keep `prompt-session` as a fallback for deferred delivery
- Default `prompt-session` messages to `steer` delivery for ongoing work, with explicit `queue` delivery for deferred follow-ups
- Share `prompt-session` completion watchers per parent/child pair, deduplicate by completion ID, wait for exact prompt anchors, and cancel watchers when the plugin unloads
- Simplify product-owner and orchestrator prompts into outcome-driven guidance with autonomous technical decisions, adaptive parallelism, and recovery instead of fixed retry stops
- Keep backlog tickets minimal and reuse project workflows, with targeted reconciliation and technical ticket adjustments within the user's mandate
- Add orchestrator-only "Automatic mode" to continue toward the established objective without confirmation or clarification questions
- Honor explicitly delegated decisions without repeated clarification and clarify authorization for irreversible, destructive, or costly orchestration actions
- Extract optional model comparisons into the on-demand `implementation-comparison` skill
- Keep durable execution references in active tickets for resuming work across sessions and restarts
- Tie delivery evidence to exact revisions and require relevant checks after every synchronization, including conflict-free updates
- Require revision-bound checks to exclude interfering uncommitted files and verify the SHA and working-tree state before and after validation
- Require workers to move and verify their own workspace from the initial prompt before edits, builds, tests, or other mutating commands
- Focus product-owner consultations on discovery with `explore` and technical constraints with `architect`
- Clarify test-first as the default for features and bugfixes, with justified alternative verification

## 1.3.0
- Register bundled agents directly through `ctx.agent.transform()` and archive matching legacy global copies while preserving customized definitions
- Make `agent-promote` and `agent-demote` temporary and location-scoped: verify the effective mode after reload, isolate projects, and reset on plugin/server restart without writing agent files
- Consolidate agent instructions and backlog rules; make tickets the integration unit while internal steps use local validation, and use targeted reconciliation between full startup/resume/closure scans
- Apply shared XP principles to seven agents: product-owner-defined ticket granularity, explicit short TDD loops, evolving design, bounded research, and targeted refactoring; retain independent review without pair programming
- Replace the orchestrator's final integration barrier with serialized incremental integration, current-head worktrees, stale-delivery revalidation, and priority recovery for failing integrated checks
- Add a primary `product-owner` agent to challenge ideas, clarify needs, and publish an approved development plan and backlog
- Rename `build-orchestrator` to `orchestrator` and add ticket creation, assignment, technical prioritization, and board reconciliation across development, research, analysis, and verification
- Add shared `backlog-management` instructions: Linear/Trello MCP when accessible, Markdown fallback, and Todo → In progress → To review → To integrate → Done workflow with at most three active tasks (In progress + To review)
- Keep validated code in To integrate until integration and checks pass; this state frees active capacity while remaining tracked

## 1.2.1
- Fix `agent-promote` having no effect on OpenCode V2: user plugin transforms are replayed before the internal config-agent transform, which re-applies `mode` from the agent markdown files on every registry rebuild and silently overwrites runtime promotions. The tool now writes the target `mode` into the bundled `agent/<name>.md` and the installed global agent file, so OpenCode's native config watcher applies it; the promoted-agents map, plugin storage persistence, and agent transform are removed

## 1.2.0
- Fix `prompt-session` attributing a completion report to the wrong turn: the watch now anchors on the inbox message id returned by the prompt (timestamp fallback) and reports only that turn's outcome
- Make the `prompt-session` completion watch resilient: transient polling failures are retried (up to 3 in a row), the watch is capped at 30 minutes, and the parent gets an explicit abandonment notification instead of waiting forever
- Escape the session title in the `<subagent>` notification attribute and deduplicate the `asRecord` helper
- Rework build-orchestrator with durable run memory: a committable ledger and `learnings.md` under `.opencode/orchestrator/`, a startup protocol that reads them and reconciles with git, and retrospectives written even for failed or abandoned runs
- Add an explicit decision policy to build-orchestrator: the orchestrator arbitrates and records decisions, with bounded escalation to the user and stop criteria
- Add research-first uncertainty triage before implementation, adversarial plan review by `rubber-duck`, re-planning triggers, and an end-to-end verification of the integrated result

## 1.1.3
- Comparison tasks: review every candidate with a single `code-reviewer` session that ends with a comparative verdict, and adopt recommended parts of discarded candidates in one rework round on the winner's implementer

## 1.1.2
- Allow read-only GitHub CLI commands in code-reviewer (`gh pr view`, `gh pr diff`, `gh api repos/*`) with deny guards on mutation flags (`--method`, `-X`)
- Allow `printf` and `git remote -v` in code-reviewer so compound inspection commands are not blocked

## 1.1.1
- Fix agent permissions being ignored on OpenCode V2: migrate legacy `permission`/`tools`/`temperature` frontmatter to the V2 `permissions` rule format
- Fix code-reviewer failing with "Permission denied: shell" by allowing read-only git commands (`fetch`, `diff`, `log`, `show`, `status`, `rev-parse`)
- Restore read-only enforcement on architect, partner, and rubber-duck (deny edit and shell) and deny shell on doc-writer

## 1.1.0
- Add a build-orchestrator agent for coordinating implementation tasks across isolated worktrees
- Load the orchestrator model configuration from `.opencode/orchestrator.md`
- Clean up worktrees and temporary artifacts as orchestrated tasks are integrated

## 1.0.1
- Fix compatibility with OpenCode V2 >= 2.0.3: the skill schema renamed `location` to `path`, which made the host disable the whole plugin after a transform failure
- Fix `session.command` input to use the renamed `name` field
- Update `@opencode/plugin` to `^2.0.5` and drop the type-cast that masked schema drift in `skill.transform`

## 1.0.0
- Migrate plugin to the OpenCode V2 API: `Plugin.define`/setup with ctx transforms, tool hooks, event subscription with cleanup, and storage persistence
- Replace custom subagent delegation, command expansion, and agent mapping with native V2 behavior (subagent frontmatter, `$ARGUMENTS`, legacy frontmatter migration)
- Install bundled commands and agents into the global config dir
- Persist promoted agent modes via plugin storage
- Rewrite tools as plain descriptors returning `{ content }`
- **Breaking:** requires OpenCode V2 (dependency moved to `@opencode/plugin@^2.0.2`)

## 0.12.0
- Add `/linear-stale-check` command to review open Linear issues and report likely active, uncertain, or obsolete work
- Document `/linear-stale-check` usage in the README

## 0.11.0
- Rely on OpenCode's native skill discovery via `config.skills.paths` instead of the plugin's custom `skill` tool and XML injection path
- Add bundled OpenSpec commands and skills under `.opencode/`
- Add `openspec/config.yaml` for OpenSpec configuration

## 0.10.2
- Fix skill discovery paths to use plural `.opencode/skills` and `.config/opencode/skills` (matching OpenCode convention)
- Replace `process.cwd()` with explicit `cwd` parameter sourced from `ctx.directory` so project skills are discovered regardless of launch directory
- Inject plugin-bundled skills into the existing native `<available_skills>` block via a dedicated `skill-injection` helper
- Improve `gh-create-pr` command

## 0.10.1
- Fix `agent-promote` so it returns successfully before the instance reloads
- Update the OpenCode plugin SDK to `1.4.6`
- Ensure runtime agent config takes precedence over loaded agent definitions during reload

## 0.10.0
- Add `tdd` skill for Test-Driven Development workflow
- Make release command language-agnostic (supports Python, Rust, Go, PHP, Ruby)
- Release command now uses Git tags as source of truth

## 0.9.1
- Allow code-simplifier to analyze untracked files
- Add example for ask-questions-if-underspecified skill
- Rewrite skills documentation with complete examples
- Fix diff-summary to list untracked files
- Fix commit-push command formatting

## 0.9.0
- Add /release command to guide release workflow
- Replace code-release skill with ask-questions skill
- Show a toast when loading a skill

## 0.8.0
- Add pdf-to-markdown tool for PDF conversion

## 0.7.2
- Document code-simplifier agent and command
- Align command docs with new instructions
- Move code-simplify guidance into agent docs

## 0.7.1
- Add code review agent commands
- Update code-reviewer docs and skills list
- Adjust GitHub release CI steps

## 0.7.0
- Add code-release skill and trim metadata
