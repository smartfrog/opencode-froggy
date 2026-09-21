# Changelog

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
