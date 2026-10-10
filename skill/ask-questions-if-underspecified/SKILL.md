---
name: ask-questions-if-underspecified
description: Clarify requirements before implementing. Use when serious doubts arise.
use_when: >
  When a request has multiple plausible interpretations or key details
  (objective, scope, constraints, environment, or safety) are unclear,
  load this skill before starting implementation.
  Do NOT use when the request is already clear or when a quick, low-risk
  discovery read can answer the missing details.
---

# Ask Questions If Underspecified

## Goal

Ask the minimum set of clarifying questions needed to avoid wrong work; do not start dependent work until the must-have questions are answered (unless the user or caller explicitly authorizes proceeding without answers or delegates those decisions).

## Workflow

### 1) Decide whether the request is underspecified

Treat a request as underspecified if after exploring how to perform the work, some or all of the following are not clear:
- Define the objective (what should change vs stay the same)
- Define "done" (acceptance criteria, examples, edge cases)
- Define scope (which files/components/users are in/out)
- Define constraints (compatibility, performance, style, deps, time)
- Identify environment (language/runtime versions, OS, build/test runner)
- Clarify safety/reversibility (data migration, rollout/rollback, risk)

If multiple plausible interpretations exist, assume it is underspecified.

### 2) Ask must-have questions first (keep it small)

Ask 1-5 questions in the first pass. Prefer questions that eliminate whole branches of work.

For a delegated task, return unresolved questions to the caller with context, options, and a recommendation when justified. Do not use `question` to ask the user directly.

In a direct user conversation, use the `question` tool to present structured choices:
- Offer multiple-choice options with clear labels
- Mark recommended defaults with "(Recommended)" in the label
- Use `multiple: true` when the user can select several options
- The user can always select "Other" for custom input

### 3) Pause before acting

When proceeding has not been authorized, pause only work that depends on the missing answers:
- Continue independently actionable work within the assigned scope
- Do perform a clearly labeled, low-risk discovery step only if it does not commit you to a direction (e.g., inspect repo structure, read relevant config files)

If the user or caller explicitly authorizes proceeding without answers or delegates the unresolved decisions, state your assumptions and proceed within that authorization and the assigned scope without requesting further confirmation.

### 4) Confirm interpretation, then proceed

Once the user or caller provides answers or delegates the decisions, restate the requirements in 1-3 sentences (including key constraints and what success looks like), then resume work.

## Anti-patterns

- Don't ask questions you can answer with a quick, low-risk discovery read (e.g., configs, existing patterns, docs).
- Don't ask open-ended questions if a tight multiple-choice or yes/no would eliminate ambiguity faster.
