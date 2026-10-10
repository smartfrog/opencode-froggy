---
name: backlog-management
description: Keep useful delivery tracking through Linear/Trello MCP or Markdown while adapting workflow to the work.
---

# Backlog Management

Use the backlog to support delivery, not as an approval queue. Keep enough context to coordinate, resume, and verify work; avoid administrative steps that do not help those goals.

## Source of truth

Use the agreed backlog and project conventions. Discover actual MCP tools, destinations, statuses, and members before writing to Linear or Trello. Without an established choice, use a clearly identified project backend or the project's Markdown backlog, defaulting to `.opencode/backlog/`. State the choice. An unresolved requested destination blocks publication; retain pending local drafts until it is identified.

Keep an existing backlog authoritative until an agreed migration. If it becomes inaccessible, continue independently actionable work and mark local notes pending reconciliation rather than treating them as remote state.

Search before creating tickets. Preserve IDs, unrelated content, and concurrent human edits. Re-read affected tickets before writes and verify results. On uncertain or failed writes, report the error and read before retrying to avoid duplicates.

## Responsibilities and tickets

The product owner clarifies product intent, priorities, acceptance, and initial scope with the user. The orchestrator owns execution: it may assign, sequence, split, regroup, or create necessary work within the mandate. Preserve product commitments and explicit user sequencing constraints; report meaningful adjustments. Keep proposed changes outside the mandate separate from committed scope until authorized.

Create only the tickets needed to coordinate delivery. A ticket should have a coherent objective; keep tightly coupled changes together instead of turning test/code/refactor/review steps into separate tickets. Missing administrative fields do not make otherwise clear work unready.

Only the coordinator edits the backlog; workers return evidence. Distinguish tracker assignees from worker sessions and do not invent platform accounts. Retain existing ticket IDs and link successor work when regrouping.

Keep tickets minimal: stable ID, title, objective, observable acceptance criteria or investigation question, and status. Add kind (`implementation`, `research`, `analysis`, `verification`), scope, priority, or rationale when useful. Record who is executing, evidence on delivery, and a next step or blocker for unfinished active work.

For active tickets, retain durable execution references where applicable: worker session ID, branch, worktree path, and last validated SHA with check commands and results. Keep these references and the next step current at handoffs and when the worker, workspace, or validated revision changes. Record missing references explicitly rather than inventing them or relying solely on conversation history.

For research, identify the question and decision it informs, and use a proportionate investigation budget. Report evidence, conclusions, and uncertainty; adapt or conclude when further investigation adds little value. Verification reports identify checks, results, and tested revision where applicable.

Record real dependencies: what upstream code, report, or decision is needed and why. Verify prerequisites before relying on them, while continuing independent preparation or work. Priority orders ready work; it is not itself a dependency. Honor explicit sequencing constraints separately. Coordinate overlapping edits rather than giving multiple workers conflicting write ownership.

Use native fields and existing statuses when practical, descriptions otherwise. Represent pending review or integration with a note when the board has no matching stage; do not require new columns to proceed.

## Markdown fallback

One file per stable ticket ID at `.opencode/backlog/<id>.md`, unless project conventions differ. Keep the filename when titles or statuses change; quote YAML values where needed.

```markdown
---
id: investigate-import-limits
title: Investigate import limits
kind: research
status: todo
---

## Objective
Determine the supported import size before planning the importer.

## Acceptance
Check published limits and one representative import within 30 minutes; recommend a size limit and identify remaining uncertainty.
```

Suggested statuses: `todo`, `in-progress`, `to-review`, `to-integrate`, `done`; follow existing project conventions. Add fields and evidence as needed. Do not automatically commit backlog edits. Reconcile drafts before remote publication and retain external links when migrating.

## Workflow and capacity

The usual flow is **Todo → In progress → To review → To integrate → Done**. Combine stages when useful, and let accepted reports bypass integration. Track actual execution: failed launches, rework, waiting deliveries, and deferred work should remain visible. Mark Done only when acceptance is verified; code delivery includes integration and relevant checks. Record pre-existing failures or unavailable checks explicitly rather than claiming they passed.

Start with a small amount of parallel work, usually up to three active tickets or workers. Adjust to task independence, available resources, coordination cost, and project limits. Count review, recovery, and waiting work when choosing what to launch; do not create extra tasks merely to occupy workers.

Prefer finishing and integrating useful increments over starting more work. An isolated blocker should affect only dependent work. If shared assumptions or integration checks fail, diagnose and recover the affected baseline before stacking further changes onto it; continue safe independent work. Keep statuses honest rather than moving tickets to satisfy a quota.

## Reconciliation

At startup or resume, read execution references from active tickets and verify them against available worker sessions and Git evidence. During execution, refresh affected tickets, dependencies, and ongoing work before decisions or writes. Broaden the scan when state is missing or inconsistent; a full backlog audit is not required for every task.

Recover stranded work, stale statuses, unattended reviews, or pending integrations when relevant. Correct discrepancies using evidence and preserve concurrent human edits. At closure, report delivered outcomes, ongoing work, and real blockers or remaining gaps. State any unavailable evidence or inaccessible tracker scope honestly.
