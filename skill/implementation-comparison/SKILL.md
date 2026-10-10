---
name: implementation-comparison
description: Compare candidate implementations across configured models for an orchestrator ticket flagged compare.
---

# Implementation Comparison

Use comparisons when evaluating alternatives is worth the additional cost. Apply the orchestrator's usual validation guidance and coordinate the work through `backlog-management`.

1. Select useful candidates from the configured pool, honoring any models the user explicitly requested. Use separate branches and worktrees at the same starting SHA for a fair comparison. Adjust parallelism to resources and coordination cost.
2. Compare candidates against the same acceptance examples and checks. A shared `code-reviewer` session can provide a consistent criterion-by-criterion assessment; use it when the risk or decision benefits from independent review. Reuse that context for corrections.
3. Choose the candidate that best meets acceptance, manages concrete risks, and avoids unnecessary complexity. Explain the choice using evidence; a reviewer's verdict is advice, not an approval gate.
4. Adopt useful parts from another candidate when the benefit justifies the rework, then validate the resulting code. Avoid repeated comparisons or polishing that no longer improves the outcome.
5. Retain useful alternatives until the selected result is validated. Synchronize and revalidate against newer integration work as needed; clean up discarded workspaces without losing uncommitted work.
