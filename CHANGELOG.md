# Changelog

## Unreleased
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
