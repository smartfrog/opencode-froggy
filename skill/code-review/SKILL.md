---
name: code-review
description: >
  Review code changes for quality, correctness, and security. Load after receiving 
  a diff or before merging changes.
use_when: >
  Use this skill when the user asks for a code review, or when you need to analyze
  changes for quality and correctness before they are committed or merged.
---

# Code Review Skill

## CRITICAL CONSTRAINT

**This is a READ-ONLY review.** You MUST NOT:
- Use the `write` tool
- Use the `edit` tool
- Modify any files
- Execute commands that change state

Your role is strictly analytical. Provide feedback only.

## Step 1: Retrieve changes

Determine the review scope based on user request:

### Working tree review (local changes)

If reviewing uncommitted local changes, run `/diff-summary` without arguments:

```
/diff-summary
```

This retrieves:
- Staged changes
- Unstaged changes  
- Untracked files content

### Branch/PR review

If the user asks to review a PR or compare branches, run `/diff-summary` with branch arguments:

```
/diff-summary <source-branch> <target-branch>
```

Examples:
- `/diff-summary feature-branch` — compare feature-branch to HEAD
- `/diff-summary feature-branch main` — compare feature-branch into main

This retrieves:
- Stats overview (files changed, insertions, deletions)
- Commits between branches
- Full diff

Focus only on the changes between the specified branches.

## Step 2: Perform code review

### Guidelines

- **Pragmatic over pedantic**: Flag real problems, not style preferences
- **Evidence-based**: Every issue must be traceable to specific diff lines
- **Actionable**: Every issue must have a clear path to resolution
- **Production-minded**: Assume this code ships to users

### Critical focus areas

1. **Discipline:** Only review code that is part of the diff. Do not flag pre-existing issues in unchanged code.
2. **Logic & Stability:** Edge cases (nulls, empty collections), race conditions, and incorrect state transitions.
3. **Security:** Injection risks, improper validation, sensitive data exposure in logs/errors.
4. **Performance:** Resource leaks, O(n^2) operations on large datasets, unnecessary network/DB calls.
5. **Maintainability:** Clear violations of SOLID principles or excessive complexity.
6. **Convention:** AGENTS.md violation (only if AGENTS.md content is available)

### Simplification focus

Identify opportunities to simplify while preserving exact functionality:
- Reduce unnecessary complexity and nesting
- Remove redundant code/abstractions introduced by the change
- Improve naming only when it prevents misunderstanding (not for preference)
- Consolidate related logic when it increases readability
- Avoid nested ternary operators; prefer if/else or switch
- Remove comments that restate obvious code
- Prefer explicit code over dense one-liners

### Operational rules

- **No scope creep:** Do not propose refactors outside the diff unless required to fix a blocking issue.
- **Evidence-Based Only:** Never flag "potential" issues without explaining *why* they would occur based on the code provided.
- **AGENTS.md Protocol:** If `AGENTS.md` exists in the repo, check it for project-specific rules. If not found, ignore all AGENTS.md instructions.
- **Zero-Noise Policy:** Do not comment on stylistic preferences (naming, formatting) unless they explicitly violate a rule in `AGENTS.md`.
- **Safety First:** Every suggestion must be provably behavior-preserving. When in doubt, omit it.
- **Non-stylistic simplification:** Simplification candidates must be justified by reduced complexity/duplication/nesting in the diff, not stylistic preference.

## Step 3: Output format

### Issues

A numbered list of blocking issues. Each issue MUST include:
- **reason**: "bug" | "security" | "correctness" | "AGENTS.md adherence"
- **location**: `<path>::<symbol>` or `<path>::<global>` + `<lines>` if available
- **evidence**: quote the exact diff hunk lines
- **fix**: either a committable patch (max 5 lines per file) or a concise, explicit instruction if a patch would exceed this limit

If no blocking issues are found, explicitly state: "No blocking issues found."

### Simplification candidates (optional)

Include this section only if there are meaningful refactors that are clearly behavior-preserving. Each candidate MUST include:
- **goal**: what clarity/maintainability improves
- **constraints**: "no behavior change", and any diff-specific invariants
- **evidence**: quote the exact diff hunk lines
- **location**: `<path>::<symbol>` or `<path>::<global>` + `<lines>` if available
- **suggested change**: either a committable patch (max 5 lines per file) or a concise refactor plan
