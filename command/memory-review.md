---
description: Review all project knowledge and propose cleanup for user validation, without modifying memory
agent: memory-manager
subagent: true
---

# Global knowledge review — report only

Review all project knowledge on explicit user request. This assignment overrides routine write behavior: produce a report only. Do not call knowledge save/remove or task-board save, and do not edit files or create a second memory store. Invoking this command is not approval to apply changes. Even if command arguments request application, report proposals and stop; application requires separate user validation after the report.

## Read the whole scope

1. Call `memory-review` and follow every `nextPage` using `page` to inventory all topics and counts. If there is no database, report that there is nothing to review. If its schema needs an upgrade, report the blocker rather than migrating it during this review.
2. For each topic, use `knowledge list` with that exact `topic`; it returns every matching entry. Use `knowledge get` for each entry and read its complete content, recording the version it shows. Retain IDs, versions and source references for the report. Titles and excerpts alone are not a content review.
3. Look for duplicates and contradictions both within and across topics. Read relevant evidence when needed. Consult tasks only to check context or references affected by a proposed knowledge change, not as a separate task audit.
4. Assess durable decision value, correctness, useful scope/conditions, topic placement and recoverability. Preserve unique user constraints, unresolved risks and recovery information. Age or low read frequency is not a reason to remove an entry. Missing evidence means uncertainty, not permission to guess or delete.

## Return proposals, not changes

Give a concise report with:
- Coverage: topics and entries actually read versus the inventory totals; explicitly list skipped or incomplete scopes. Never claim a complete global review if content/pages were omitted or changed during reading.
- Numbered proposals (`P1`, `P2`, ...): corrections, merges, removals or useful additions supported by evidence. Identify affected IDs and read versions, the reason, the surviving entry for each merge, and references needing reconciliation. Do not invent additions just to fill a category.
- Uncertain findings and missing evidence; distinguish these from confirmed defects. A healthy store may need no changes.
- A clear statement that no changes were applied and that the proposals await user validation. The parent must present this report to the user, not silently authorize application itself.

The inventory is live, not a frozen snapshot. If changes prevent full coverage, report that limitation. After separate user approval, the manager must reread affected records and reconcile their current versions before applying only the approved proposals through the existing tools. Do not apply anything in this review pass.
