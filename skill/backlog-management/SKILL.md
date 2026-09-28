---
name: backlog-management
description: Manage ticket responsibilities, workflow, and capacity through Linear/Trello MCP tools or a Markdown fallback.
---

# Backlog Management

## Source of truth

Discover available MCP tools and the agreed backlog from project conventions and conversation. Use the selected accessible Linear or Trello MCP. If no choice exists, use the sole available backend or ask when both are available. Resolve project/board, statuses, priorities, and members from actual data; never invent tool names or destination IDs.

Without an accessible MCP, use the project's Markdown backlog or `.opencode/backlog/`. State the backend. Keep an existing backlog authoritative until an agreed migration. If a remote backlog becomes inaccessible, local drafts must be marked pending reconciliation, not treated as a copy of remote state.

Search before creating tickets. Preserve IDs, unrelated content, and concurrent human edits. Re-read affected tickets before writes and verify results. On uncertain or failed writes, report the error and read before retrying to avoid duplicates.

## Responsibilities and tickets

The product owner defines ticket boundaries, product priorities, and acceptance with the user. Tickets may be functional, technical, research, analysis, or verification work; they need a coherent executable objective, not necessarily standalone user value. Keep tightly coupled changes together.

The orchestrator assigns under the agreed policy, orders execution, and may create necessary discovered work within approved scope. It proposes ticket splits or redefinition to the product owner; product scope/value changes require user agreement. Only the coordinating agent edits the backlog; workers return evidence. Distinguish tracker assignees from worker sessions. If no member is designated, record the orchestrator as execution coordinator without inventing a platform account.

Each ticket records:
- Stable ID, title, kind (`implementation`, `research`, `analysis`, `verification`), objective, and rationale.
- Scope/exclusions, concrete acceptance examples or questions, priority with rationale, dependencies, and origin/parent if relevant.
- Status, owner when known, evidence, blockers, and next steps as work progresses.

Research/analysis has a question, investigation budget, and expected decision. Research reports include sources, alternatives, recommendation, and confidence; analysis reports include evidence, conclusions, impacts or root cause, and unresolved questions. Stop when evidence suffices or the budget expires. Verification reports identify checks, results, and tested SHA where applicable.

A ticket is the delivery unit. Internal test/code/refactor/review steps do not become separate tickets automatically. Dependencies between implementation tickets require verified integration; steps within one ticket require local validation in its shared workspace.

Use native platform fields and relations when available, descriptions otherwise. Map states to existing lists/statuses. Agree on missing stages such as To integrate before creating them or using an explicit marker. Preserve priority conventions; Trello ordering or labels may represent priority.

## Markdown fallback

One file per stable ticket ID at `.opencode/backlog/<id>.md`, unless project conventions differ. Keep the filename when titles or statuses change; quote YAML values where needed.

```markdown
---
id: investigate-import-limits
title: Investigate import limits
kind: research
status: todo
priority: medium
owner: null
depends_on: []
parent: null
external_url: null
---

## Need and objective
## Scope and exclusions
## Acceptance criteria
## Priority rationale
## Findings and evidence
## Blockers and next steps
```

Statuses: `todo`, `in-progress`, `to-review`, `to-integrate`, `done`. Priorities: `critical`, `high`, `medium`, `low`, unless existing conventions differ. Do not automatically commit backlog edits. Reconcile drafts before remote publication and retain external links when migrating.

## Workflow and capacity

| State | Meaning |
| --- | --- |
| Todo | Reserve of work; may remain without owner, next action, or execution commitment. Unclear implementation is not ready to start. |
| In progress | Work started with responsibility, criteria, and dependencies understood. |
| To review | Delivery/report awaits validation with evidence. Rejection returns it to In progress. |
| To integrate | Code passed its gate at an immutable SHA; record target, dependencies, and blockers. Frees an active slot but remains tracked. |
| Done | Acceptance verified; development requires integrated code and passing checks. Accepted reports bypass To integrate. Failure/abandonment is not Done; integration is not deployment. |

At most **3 active tickets in In progress + To review**, including resumed or blocked work already in the agreed scope. Independent untracked work counts too; internal sequential steps share their ticket's slot. Also cap concurrent workers, including comparison candidates, at 3. Reviews/tests of an existing ticket do not create another ticket slot. Todo and To integrate do not count.

Prioritize ready integrations and finishing active work before pulling Todo. Integration rework returns to In progress only after capacity is reserved, then repeats validation. Do not hide ongoing development in To integrate or move blocked work to Todo merely to free capacity. Explicit deferral stops execution and records how to resume. If capacity already exceeds 3, start nothing new and resolve it without rewriting others' work.

Integrate serially as dependencies permit, without a whole-scope barrier. Verify the combined revision. A failing integrated build takes priority over new dispatch and further integrations.

## Reconciliation

At startup, resume, and closure, read every page in the agreed scope, including work from earlier sessions. Compare statuses with execution, reports, reviews, Git evidence, and dependencies; inspect relevant Done evidence. Report inaccessible pages rather than claiming a complete scan.

Between transitions and before dispatch, refresh affected tickets, their dependencies, and the full active set needed to count capacity. Check pending integrations before selecting new work. Use a full reconciliation if state conflicts, missing work, or stale context prevents a reliable decision.

Find stranded execution, unattended reviews/integrations, resolved blockers, duplicates, and false completion. Each unfinished non-Todo ticket needs a known next step or blocker. Correct only evidence-backed discrepancies within your authority. Report outcomes, active count, pending reviews/integrations, and unresolved blockers; Todo may remain untouched.
