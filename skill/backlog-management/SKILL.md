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

Each task has an ID, title, status and one current Markdown description. Statuses are `todo`, `in-progress`, `blocked`, `review`, `done`.

Keep only scope, observable acceptance, established state, blocker, next action and necessary evidence/recovery links. Include worker/session/workspace/revision references needed to resume. Parents link children instead of copying their detail. Done tasks retain the accepted result, revision, proof, remaining limits and their own recovery/cleanup, not other tasks' stale state. Replace obsolete sections; keep title, status and description consistent. There are no task notes, update feeds or history sections. Link existing evidence instead of test-count, log, cleanup or superseded-trial inventories; never create reports merely to relocate redundant prose. Dispatch is not execution; a check is not product acceptance.

Search before creating; task-only updates need no unrelated knowledge discovery. Preserve IDs and concurrent work; change only affected records/fields and verify writes. Narrow discovery with a status, topic or query. Read full affected records before replacing content and use the returned version for updates. If rendering is truncated, obtain the missing text through an authorized path; if it remains unread or inaccessible, stop that replacement and report incomplete coverage. Excerpts and summaries do not substitute for the full record.

## Ownership and knowledge

The product owner clarifies product intent, priorities, acceptance and initial scope. The orchestrator owns execution within that mandate, including assignments, sequencing and integration. Preserve explicit user constraints and report meaningful scope adjustments.

All agents may read `task-board` and `knowledge`. Only `memory-manager` may save tasks or save/remove knowledge. Never bypass those tools with SQL, shell or file edits. Use the current `expectedVersion` from a full read to update or remove a record.

Delegate bounded scope, affected IDs/fields, new facts, coordinator decisions, obsolete conclusions and evidence links, not a transcript or prewritten prose. Distinguish verified facts/decisions from requested or planned work. The manager must preserve technical meaning, not infer execution or add approval gates; delegation-only instructions never enter records. Preserve unique user constraints, unresolved risks and recovery references; honor explicit user retention instructions and report limitations. Keep one writer per scope until handback; inspect partial writes after termination before reassigning. Resolve conflicts instead of forcing writes.

Keep knowledge only for durable, non-obvious decision or recovery value not already covered by code, config or docs. State current conclusions with precise technical conditions, uncertainty and evidence links, not trial sequences. Replace obsolete explanations; retain a failed approach only when its conditions and failure reason help avoid repeating it. Search before creating; prefer correcting or merging an existing home, or return `No change`. Temporary state stays in tasks; logs and detailed measurements stay in linked evidence. Knowledge removal is real deletion, not archival: preserve unique constraints, unresolved risks and recovery information unless evidence explicitly supersedes them. Save and verify merged content before deleting duplicates. Size alone is not a deletion criterion.

Verify the resulting affected records against execution decisions and supplied evidence, not just the receipt: current titles, statuses, blockers and next steps must agree, with necessary recovery references preserved. A receipt proves persistence, not correctness or task acceptance. Version conflicts, incomplete reads or partial writes remain visible.

## Delivery and recovery

Mark done only when acceptance and required independent review are complete; code delivery also includes integration and relevant checks. Keep pending review and blocking findings visible. Record reviewer session, reviewed diff/revision, findings and disposition in the existing task, with detailed reports linked rather than copied.

For active work, retain each worker's bounded assignment, agent, session ID, branch, worktree path and last validated SHA/checks when relevant. Associate sessions with their deliverable, not merely a role. On resume, recover missing references from relevant tasks and verify sessions and Git state; memory is not proof of present activity.

For temporary workspaces, record `active`, `retained` with reason/next step, or `removed` after verification in the associated task description. A done task may still have unresolved workspace cleanup. Preserve branches, recovery refs and evidence outside workspaces being removed. Unknown ownership or activity blocks removal. Follow the orchestrator's workspace lifecycle.

The SQLite database and linked evidence are local project data, not protected by code commits unless explicitly included. Do not automatically commit/publish memory, change ignore rules or delete backups. Before removing an authoritative checkout, verify recovery elsewhere. Migration backups are retained until their owner explicitly authorizes cleanup.

## Keep work moving

Prefer finishing useful increments over maximizing parallel work. Start with a small number of independent assignments and adapt to resources and coordination cost. Track real dependencies, honor explicit sequencing constraints, and continue independent work when one branch is blocked.

At meaningful transitions and before closure, reconcile affected tasks, pending reviews, worker assignments and workspace cleanup. Reuse valid evidence; a full-project audit is not required on every reminder. Report delivered outcomes, unfinished work and verification gaps honestly.
