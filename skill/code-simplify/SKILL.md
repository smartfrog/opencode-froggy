---
name: code-simplify
description: >
  Simplify code you just wrote or modified. Load after completing a feature, fix, or refactor 
  to improve clarity while preserving behavior.
use_when: >
  After ANY code modification (write, edit, refactor). Call BEFORE responding to user or
  marking task complete.
---

# Code Simplification Skill

## Step 1: Identify changes

Run `/diff-summary` to retrieve:
- Staged changes
- Unstaged changes
- Untracked files content

Focus only on code files that were modified or introduced in the current session.

## Step 2: Apply simplifications

### Core principles

#### Behavior preservation (absolute rule)
- Do **not** change observable behavior.
- Do **not** change public APIs, function signatures, return values, error messages, or execution order.
- Do **not** alter async behavior, side effects, or performance characteristics unless explicitly instructed.
- If behavior preservation cannot be proven, **do not apply the change**.

#### Scope discipline
- Only simplify code that was **modified or introduced in the current session**.
- Do not refactor adjacent or pre-existing code unless strictly required to simplify the modified section.
- No cross-file refactors unless the change itself spans multiple files.

#### Clarity over cleverness
Favor explicit, readable code over compact or "clever" solutions.
- Prefer simple control flow over dense expressions.
- Prefer explicit variable names over implicit meaning.
- Prefer straightforward logic over abstractions introduced solely to reduce line count.

### Simplification focus

Apply simplifications only when they clearly improve readability or maintainability:

- Reduce unnecessary nesting and branching.
- Remove redundant checks, conversions, or temporary variables introduced by the change.
- Consolidate closely related logic when it improves readability **without merging concerns**.
- Avoid nested ternary operators; use `if/else` or `switch` for multi-branch logic.
- Remove comments that restate obvious code; keep comments that explain intent or non-obvious decisions.
- Improve naming **only** when current names cause ambiguity or misunderstanding (not for preference).

### Project standards

- If a project standards file exists (e.g. `CLAUDE.md`, `AGENTS.md`), follow it.
- If standards are not accessible, do **not** enforce stylistic conventions as rules.
- Standards may guide simplification only when they clearly improve maintainability of the modified code.

### Non-goals (do NOT do these)
- Do not optimize performance unless simplification naturally preserves it.
- Do not introduce new abstractions unless they clearly reduce complexity.
- Do not refactor for consistency across the whole codebase.
- Do not reformat code purely for style or aesthetics.
- Do not rewrite working code "because it could be nicer".

## Step 3: Execute

1. Analyze the diff for unnecessary complexity, redundancy, or unclear structure.
2. Apply minimal, behavior-preserving refinements using the `edit` tool.
3. Re-check that functionality, outputs, and side effects are unchanged.

### Output requirements

- Apply changes directly to the code.
- Keep changes minimal and localized.
- If no meaningful simplification is possible, make no changes and state so.
- If a change could be controversial or borderline, prefer omission.

Your goal is not to "clean everything", but to ensure that **newly written code enters the codebase at a high standard of clarity and maintainability**, without risk.
