---
name: backlog-management
description: Keep simple delivery tracking and valuable project knowledge through the structured store or an explicitly chosen external tracker.
---

# Backlog Management

Use tracking to coordinate, resume and verify delivery, not as an approval queue. Create only tasks with a coherent outcome; do not create a ticket for every worker, test or trial.

## Source of truth

Use one authoritative backlog. By default use `task-board` in the canonical project's `.opencode/memory/memory.db`, shared across its worktrees. Do not maintain a parallel Markdown backlog or coordination journal as live state. Existing Markdown files are not automatically imported or deleted; agree a migration before changing their authority.

If Linear or Trello is explicitly requested, discover its actual MCP tools, destinations, statuses and members before writing. An unresolved destination blocks publication, not independently actionable work. Do not silently replace an external tracker with local state or synchronize two authoritative backlogs. External trackers retain their established ownership rules.

## Simple tasks

Each task has an ID, title, status and detailed Markdown description. Statuses are `todo`, `in-progress`, `blocked`, `review`, `done`.

Keep scope, observable acceptance, established state, blocker, next action and necessary evidence/recovery links in one coherent current description. Include worker/session/workspace references when needed to resume. Keep title, status and description consistent by replacing obsolete sections, not appending each transition. There are no task notes, update feeds or history sections. Detailed trials stay in linked reports; do not generate reports merely to relocate redundant prose. Dispatch is not proof of execution; an experiment or static check does not establish product acceptance.

Search before creating, preserve IDs and concurrent work, and verify writes. Narrow discovery with status/topic/query or literal body `grep` on one known ID. Prefer manager `edit` for local description/content changes using relevant context; use `save` for metadata or real consolidation. Whole-field replacements and knowledge removals require a FULL version-consistent read; reuse complete valid context or continue slices with the same version and returned next offset. Stop whole replacement if content remains inaccessible. Reading for understanding does not require emitting a whole document.

## Ownership and knowledge

The product owner clarifies product intent, priorities, acceptance and initial scope. The orchestrator owns execution within that mandate, including assignments, sequencing and integration. Preserve explicit user constraints and report meaningful scope adjustments.

All agents retain direct on-demand reads of `task-board` and `knowledge`. Only memory-manager saves/edits/restores tasks and saves/edits/removes/restores knowledge, or creates verified copies with `memory-backup`. The orchestrator owns operational execution and acceptance decisions; the manager persists them, including metadata, review/session/workspace/recovery references and delivery transitions. All instructions below to record/update/mark state mean manager writes, not direct orchestrator writes. Never bypass those tools with SQL, shell or file edits.

Before delegating curation, ask what future decision the knowledge would improve. Existing-record corrections and explicit memory requests may justify it; status, tests, reminders, review references or unchanged state alone do not. Group available useful candidates in one bounded pass. Do not delay needed task/recovery references, explicit user retention or important confirmed findings while blocked or in progress, or wait for done. Delegate task consolidation only for a concrete benefit such as demonstrated redundancy or obsolete state, not length alone.

Delegate IDs/fields, intended changes, verified facts, coordinator decisions, obsolete conclusions, bounded scope and evidence links. Draft text is allowed; the orchestrator need not reconstruct/send whole records. The manager reads required affected current context and searches relevant existing knowledge for duplicates. Clean only scoped redundancy or obsolete prose; preserve facts, scope, negation, uncertainty, constraints, operator decisions and recovery references. Do not silently refuse/change execution or acceptance decisions as an editorial preference; report contradictions or ambiguity. Honor retention instructions. Keep one manager per scoped record until handback. Inspect partial writes after termination before reassigning; resolve conflicts instead of forcing or blindly retrying.

The manager decides which knowledge has durable decision value: constraints, performance tips, pitfalls, failure causes, recovery procedures and design decisions. Entries state current conclusions, their conditions, uncertainty and evidence links, not the sequence of trials. Replace obsolete explanations instead of appending contradictory verdicts; retain a refuted lead only as a useful warning against repeating a mistake, with its conditions and source. The manager searches before creating, corrects and merges existing entries, and may refuse material or return `No change`. Temporary status stays in tasks; logs and detailed measurements stay in referenced files. Knowledge removal hides current content but retains technical recovery history; it is not erasure. The manager must preserve unique constraints, unresolved risks and recovery information unless evidence explicitly supersedes them. Save and verify merged content before removing duplicates. Size alone is not a removal criterion.

`/memory-review` runs through memory-reviewer, whose mutations are rejected by the record tools. It reports proposals; user-approved application is a separate memory-manager pass. History retains current + one previous version, not a full timeline; removal keeps only the last saved content and a distinct removal token. Each edit replaces the previous version, so request an explicit backup before broad curation when that buffer is insufficient. Restoring a retained version requires the current record token, or the fresh removal token for deleted knowledge, and creates a new current version. Recheck acceptance and references after restoration; recovery is not routine context or activity tracking.

The manager verifies affected changes against execution decisions and evidence: titles, statuses, blockers and next steps must agree, with recovery references preserved. Return compact IDs, versions, outcome, verification, meaningful refused or ambiguous items, blockers and next action. The orchestrator checks this handback and requests decision-critical details when needed; no full-record echo or parent readback by default. A receipt proves persistence, not correctness or task acceptance. Version conflicts, incomplete reads or partial writes remain visible.

## Delivery and recovery

Mark done only when acceptance and required independent review are complete; code delivery also includes integration and relevant checks. Keep pending review and blocking findings visible. Record reviewer session, reviewed diff/revision, findings and disposition in the existing task, with detailed reports linked rather than copied.

For active work, retain each worker's bounded assignment, agent, session ID, branch, worktree path and last validated SHA/checks when relevant. Associate sessions with their deliverable, not merely a role. On resume, recover missing references from relevant tasks and verify sessions and Git state; memory is not proof of present activity.

For temporary workspaces, record `active`, `retained` with reason/next step, or `removed` after verification in the associated task description. A done task may still have unresolved workspace cleanup. Preserve branches, recovery refs and evidence outside workspaces being removed. Unknown ownership or activity blocks removal. Follow the orchestrator's workspace lifecycle.

The SQLite database and linked evidence are local project data, not protected by code commits unless explicitly included. Do not automatically commit/publish memory, change ignore rules or delete backups. Before removing an authoritative checkout, verify recovery elsewhere. Migration backups are retained until their owner explicitly authorizes cleanup.

## Keep work moving

Prefer finishing useful increments over maximizing parallel work. Start with a small number of independent assignments and adapt to resources and coordination cost. Track real dependencies, honor explicit sequencing constraints, and continue independent work when one branch is blocked.

At meaningful transitions and before closure, reconcile affected tasks, pending reviews, worker assignments and workspace cleanup. Reuse valid evidence; a full-project audit is not required on every reminder. Report delivered outcomes, unfinished work and verification gaps honestly.
