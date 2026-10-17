---
name: backlog-management
description: Keep useful delivery tracking through Linear/Trello MCP or Markdown while adapting workflow to the work.
---

# Backlog Management

Use the backlog to support delivery, not as an approval queue. Keep enough context to coordinate, resume, and verify work; avoid administrative steps that do not help those goals.

## Source of truth

Use one authoritative backlog under the agreed project conventions. Without an established choice, use the project's existing backend or local Markdown at `.opencode/backlog/`. State the backend and its location; do not maintain a second operational backlog in memory, coordination journals, or another tracker. When Linear or Trello is requested, discover actual MCP tools, destinations, statuses, and members before writing. An unresolved requested destination blocks publication; retain pending local drafts until it is identified.

Keep an existing backlog authoritative until an agreed migration is verified. Reconcile open work against sessions and evidence, including unresolved recovery or workspace cleanup on completed tickets; preserve ticket IDs, constraints, review and recovery references, and retain the original history. Independently check the migrated current state before recording the new authority and stopping updates to the previous backend. Keep the previous tracker accessible as history rather than deleting it or synchronizing both backlogs. If a tracker becomes inaccessible, continue independently actionable work and mark local notes pending reconciliation rather than treating them as remote state.

Search before creating tickets. Preserve IDs, unrelated content, and concurrent human edits. Re-read affected tickets before writes and verify results. On uncertain or failed writes, report the error and read before retrying to avoid duplicates.

## Responsibilities and tickets

The product owner clarifies product intent, priorities, acceptance, and initial scope with the user. The orchestrator owns execution: it may assign, sequence, split, regroup, or create necessary work within the mandate. Preserve product commitments and explicit user sequencing constraints; report meaningful adjustments. Keep proposed changes outside the mandate separate from committed scope until authorized.

Create only the tickets needed to coordinate delivery. A ticket should have a coherent objective; keep tightly coupled changes together instead of turning test/code/refactor/review steps into separate tickets. Missing administrative fields do not make otherwise clear work unready.

The coordinator owns the backlog. For `memory-manager` curation, keep one active assignment per backlog, record its session and named files, and suspend coordinator edits to those files. Resume ownership after handback, or after confirmed termination and inspection of partial writes; reconcile incoming results afterward. Do not bypass conflicts or clear locks without verifying abandonment. Other workers return evidence without editing coordination files. Distinguish tracker assignees from worker sessions and do not invent platform accounts; retain ticket IDs and link successor work when regrouping.

Keep tickets minimal: stable ID, title, objective, observable acceptance criteria or investigation question, and status. Add kind (`implementation`, `research`, `analysis`, `verification`), scope, priority, or rationale when useful. Record who is executing, evidence on delivery, and a next step or blocker for unfinished active work.

Maintain a short current snapshot, not an appended execution diary. Update the current result, blocker, next action, and execution references at meaningful transitions; keep detailed trials, logs, and historical milestones in linked reports or archives. Before shortening existing records, preserve and verify the full history and keep necessary evidence and recovery references discoverable. Keep the parent outcome current too: a completed experiment or static check does not establish the product objective.

Keep old detail in a live ticket only when it still affects a next decision, safety, acceptance or recovery; otherwise link its evidence. Milestone curation through `memory-manager` follows the ownership contract above, not an automatic pass on every update. The coordinator retains decisions and independent-review responsibility.

For active tickets, retain durable execution references where applicable: each worker's bounded assignment, agent, session ID, branch, worktree path, and last validated SHA with check commands and results. Associate sessions with their specific deliverable rather than an agent role or the overall project. Keep these references and the next step current at handoffs and when the worker, workspace, or validated revision changes. Record missing references explicitly rather than inventing them or relying solely on conversation history.

For each temporary workspace, including review and validation worktrees, keep its ownership/assignments and lifecycle state in the associated ticket: `active`, `retained` with a reason and next step, or `removed` after verified removal. Preserve the original path, branch/ref and SHA, session IDs and their current locations, and durable evidence or recovery paths after removal; a removed directory is not a usable evidence link. Delivery status and workspace state are separate: a Done ticket can retain a blocked workspace cleanup.

For reviewed deliveries, record the reviewer session, reviewed revision or diff, findings, and their disposition in the existing ticket. Keep pending reviews and unresolved blocking findings visible.

For research, identify the question and decision it informs, and use a proportionate investigation budget. Report evidence, conclusions, and uncertainty; adapt or conclude when further investigation adds little value. Verification reports identify checks, results, and tested revision where applicable.

Record real dependencies: what upstream code, report, or decision is needed and why. Verify prerequisites before relying on them, while continuing independent preparation or work. Priority orders ready work; it is not itself a dependency. Honor explicit sequencing constraints separately. Coordinate overlapping edits rather than giving multiple workers conflicting write ownership.

Use native fields and existing statuses when practical, descriptions otherwise. Represent pending review or integration with a note when the board has no matching stage; do not require new columns to proceed.

## Local Markdown backlog

One file per stable ticket ID at `.opencode/backlog/<id>.md`, unless project conventions differ. Record one authoritative absolute directory shared across worktrees; do not create divergent copies. The bundled `memory-manager` supports only direct `.md` tickets in the canonical project's `.opencode/backlog/` and its `.opencode/orchestrator/learnings.md`. Check this before delegation: a custom directory or another retained checkout remains coordinator-written, not silently moved. Keep filenames when titles/statuses change; quote YAML values where needed. Do not create a ticket per worker, review, test or trial.

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

Suggested statuses: `todo`, `in-progress`, `to-review`, `to-integrate`, `done`; follow existing project conventions. Add fields and evidence as needed. Reconcile drafts before remote publication and retain external links when migrating.

### Conservation

Keep authoritative files in a retained checkout. Local files survive a service restart, but Git-untracked/ignored files and uncommitted edits are not protected by commit history. Record the conservation mode with the authority path: explicitly approved Git commits, a verified backup outside checkouts being removed, or `local-only` when neither is established. Do not automatically commit backlog/memory, alter ignore rules, or publish archives; review sensitive evidence before inclusion. An archive in the same checkout is preservation history, not an independent backup. Before cleaning/removing its authoritative checkout, verify current files and necessary evidence are recoverable elsewhere. On resume, verify sessions and Git state from ticket references; a readable snapshot alone does not prove they are still current.

## Workflow and capacity

The usual flow is **Todo → In progress → To review → To integrate → Done**. Combine stages when useful, and let accepted reports bypass integration. Track actual execution: failed launches, rework, waiting deliveries, and deferred work should remain visible. Mark Done only when acceptance and required independent review are complete; code delivery also includes integration and relevant checks. Record pre-existing failures or unavailable checks explicitly rather than claiming they passed.

Start with a small amount of parallel work, usually up to three active tickets or workers. Adjust to task independence, available resources, coordination cost, and project limits. Count review, recovery, and waiting work when choosing what to launch; do not create extra tasks merely to occupy workers.

Prefer finishing and integrating useful increments over starting more work. An isolated blocker should affect only dependent work. If shared assumptions or integration checks fail, diagnose and recover the affected baseline before stacking further changes onto it; continue safe independent work. Keep statuses honest rather than moving tickets to satisfy a quota.

## Reconciliation

At startup, resume, or after compaction, recover missing execution references from relevant open tickets and verify them against available worker sessions and Git evidence. Reuse context already available; read detailed reports only when needed for a decision or validation. During execution, refresh affected tickets, dependencies, and ongoing work before decisions or writes. Broaden the scan when state is missing or inconsistent; a full backlog audit is not required for every task or periodic reminder.

Reconcile this orchestration's temporary workspace inventory with ticket references at startup/resume, periodic coordination, and closure, including completed tickets with unreleased workspaces. After each accepted delivery or report, record verified releases or retention reasons using the orchestrator's workspace lifecycle. Inactivity is not proof of completion or permission to remove a workspace; unknown ownership or activity blocks removal.

Recover stranded work, stale statuses, unattended reviews, or pending integrations when relevant. Correct discrepancies using evidence and preserve concurrent human edits. At closure, report delivered outcomes, ongoing work, and real blockers or remaining gaps. State any unavailable evidence or inaccessible tracker scope honestly.
