---
description: Review open Linear issues to check if they are still relevant
agent: plan
---

## Your task

Analyze the team's open Linear issues, diagnose each one by combining Linear
metadata with codebase investigation, and present a single report.

This command is read-only:
- Do not ask the user questions except when `AGENTS.md` does not define a
  Linear team.
- Do not modify any Linear issue.
- Do not add comments to Linear issues.
- Do not modify `AGENTS.md` or any other project file.
- Do not start an iterative review loop.

The user will read the report and decide what to do next.

## 1. Resolve the Linear team

Read `AGENTS.md` from the current project and look for a plain-text line:

```text
Linear team: <name>
```

If the line exists, use `<name>` as the Linear team.

If the line does not exist:
- Use `linear_list_teams` to list available teams.
- Ask the user to choose one of the available teams with the `question` tool.
- Use the selected team for this run.
- Continue the stale-check report normally.
- Do not write to `AGENTS.md` yourself.

## 2. Fetch open issues

Use `linear_list_issues` for the resolved team:
- `team`: resolved Linear team name
- omit `state` entirely; do not pass `uncompleted`, `backlog`, `unstarted`,
  `started`, an empty string, or any other status-type alias
- omit `priority` entirely; do not pass `priority: 0` because that filters to
  issues with no priority
- `orderBy`: `updatedAt`, oldest first
- fetch all matching issues by paginating until there are no more pages

Only pass filters that are intentionally active. For unused filters, omit the
field entirely instead of passing an empty, zero, or placeholder value. In
particular, `priority: 0` is an active Linear filter for "No priority" and
will exclude Medium, High, and Urgent issues.

After fetching all team issues, filter locally:
- keep issues whose `statusType` is not `completed`
- keep issues whose `statusType` is not `canceled`

Do not rely on Linear state-type aliases for this command. They can return
incomplete results. Fetch broadly for the team, then filter locally by
`statusType`.

For each retained issue, load detailed data with `linear_get_issue` and include relations:
- title
- description
- URL
- state
- priority
- assignee
- labels
- project
- createdAt
- updatedAt
- blocking and blocked-by relations

## 3. Diagnose each issue

Diagnose every fetched issue before producing the final report.

### Linear signals

Compute these signals for every issue:
- Days since last update.
- No assignee.
- No project.
- No useful description.
- `In Progress` but inactive for more than 30 days.
- Blockers are already closed or canceled.

### Code investigation

Run code investigation for every issue except issues whose state is exactly
`In Progress`.

For `In Progress` issues, set code signals to:

```text
skipped (in progress)
```

For all other issues, investigate the codebase directly with read-only search
tools and git history commands. Run searches in parallel batches when possible.

For each issue, use:
- the Linear identifier
- the title
- a concise description excerpt
- candidate keywords from the title and description

Candidate keywords should include:
- mentioned files or modules
- function, class, type, command, hook, or config names
- the Linear identifier itself
- meaningful product or domain terms

Search for relevance signals and keep the result to 3-5 concise lines:
- Does the mentioned code or feature still exist?
- Is the Linear identifier referenced in code, comments, TODOs, branches, or recent commits?
- Is there recent git activity on related files or symbols?
- Are there signs the feature was removed, renamed, or replaced?

Summarize the returned investigation as code signals:
- code or feature found
- code or feature not found
- identifier referenced
- recent git activity found
- no recent git activity found
- no code correlation found

## 4. Assign a verdict

Assign exactly one verdict per issue:

- 🔴 Likely obsolete
- 🟡 Uncertain
- 🟢 Likely active

Use these rules as guidance, but apply judgment based on the full evidence.

For `In Progress` issues, base the verdict on update age only:
- updated less than 30 days ago: 🟢 Likely active
- updated 30-90 days ago: 🟡 Uncertain
- updated more than 90 days ago: 🔴 Likely obsolete

For other issues:
- Use 🟢 Likely active when the issue is referenced in code, has recent related git activity, or clearly describes current code.
- Use 🟡 Uncertain when signals are mixed or weak.
- Use 🔴 Likely obsolete when mentioned code is missing, the feature appears removed or replaced, or the issue has weak Linear signals and no code correlation.

## 5. Output a single report

Output one report only. Sort by verdict in this order:
1. 🔴 Likely obsolete
2. 🟡 Uncertain
3. 🟢 Likely active

Use this structure:

```markdown
# Linear Stale-Check Report

Team: <team>
Issues analyzed: <count>

## 🔴 Likely Obsolete (<count>)

### LIN-123 — Issue title

URL: <Linear URL>
State: <state> | Priority: <priority> | Assignee: <assignee or none> | Updated: <N>d ago
Project: <project or none> | Labels: <labels or none>

Summary: <1-2 line summary of the issue>

Linear signals:
- <signal>
- <signal>

Code signals:
- <signal>
- <signal>

Verdict: 🔴 Likely obsolete — <short reason>

## 🟡 Uncertain (<count>)

...

## 🟢 Likely Active (<count>)

...
```

Keep each issue concise. Prefer useful evidence over speculation.

End the report with:

```text
End of report. No issues were modified.
```
