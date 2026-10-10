---
name: tdd
description: Apply Test-Driven Development workflow for new features and bugfixes.
---

# Test-Driven Development

Use short test/code/refactor loops. Test-first is the default for features and bugfixes. When another form of verification is more appropriate, explain why and report the alternative check and its result; choose meaningful verification over formal compliance.

## Workflow

1. Pick an observable behavior from the acceptance criteria. For a bug, reproduce the failure with a focused test or another reliable check.
2. Before implementation, write or update a behavioral test, run it, and confirm the failure comes from the missing or incorrect behavior, not a broken fixture or environment.
3. Implement the simplest correct change, run the relevant checks, and refactor only where useful. Keep the loop with the implementer rather than splitting test, code, and refactor across workers.
4. Repeat as needed, then run the project's required checks. Report actual commands, results, and meaningful verification gaps. Never claim a red/green cycle or a passing check that did not happen.

## Adapt verification to the change

- Test observable behavior and regressions, not implementation details. Prefer deterministic, readable tests; reuse existing coverage when it already proves the behavior.
- Use unit tests for isolated logic, integration or contract checks for boundaries, and end-to-end checks for critical journeys where useful.
- For refactoring, rely on existing behavior tests and add characterization coverage when needed. For documentation or small reversible low-impact changes, use direct checks rather than artificial tests.
- For UI work, visual or interaction checks may be more useful than unit tests. For exploratory work, report findings and limitations before treating it as production-ready.
- If an environment or test setup is unavailable, investigate or use an appropriate alternative check and state the remaining uncertainty. Keep independently verifiable work moving; track material verification debt when it remains.
