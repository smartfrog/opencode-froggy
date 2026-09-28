---
name: tdd
description: Apply Test-Driven Development workflow for new features and bugfixes.
---

# TDD Protocol

## Core Principle

- **TDD First**: Test-Driven Development is the default approach.
- **Goal**: Prioritize behavioral correctness and regression safety over formal compliance.

## Workflow

1. **Requirement Synthesis**: Briefly summarize the requirements before coding.
2. **Red**: Choose one observable behavior, write its test, and run it. Confirm it fails because that behavior is missing or incorrect, not because of a broken fixture or environment. For a bug, reproduce it before fixing it.
3. **Green**: Write the minimum implementation that makes this test pass. Run relevant existing tests to detect regressions.
4. **Refactor**: Improve the changed code and tests where useful without changing behavior; keep tests green. Make no refactor when none is justified.
5. Repeat steps 2–4 for the next behavior. Keep this loop inside the implementing agent while the ticket is In progress; do not write the entire test suite first or delegate test, code, and refactor as separate tasks.
6. Run the project's required checks before delivery. Report commands, results, the observed failure and subsequent success, and any justified exception. Never claim a red/green cycle that was not actually executed.

## Mandatory Rules

- **No Test, No Code**: Every new feature or bugfix must include relevant test coverage.
- **Black-Box Testing**: Validate observable behavior, not internal implementation details.
- **Merge Requirement**: Tests are mandatory for completion unless an explicit exception is documented.

## Preferred Practice

- **Short feedback loops**: Use Red-Green-Refactor by default for features and bugfixes; exceptions below require a reason and an appropriate alternative verification.
- **Right-Sized Testing**:
  - **Unit Tests**: For pure logic and isolated functions.
  - **Integration Tests**: For system interactions and API boundaries.
  - **E2E Tests**: For critical user journeys and "happy paths."

## Explicit Exceptions (Must be justified)

- Pure refactoring: run existing behavior tests before and after; add characterization coverage first when necessary.
- Documentation-only changes: check accuracy, links, or examples as appropriate rather than adding artificial unit tests.
- Exploratory spikes or R&D: report findings and limitations; apply production checks before promoting experimental code.
- UI/Styling iterations where unit tests offer diminishing returns: use visual or interaction verification.
- Complex integrations where mocking is counterproductive: use integration or contract checks when feasible; document unavailable environments and do not claim unexecuted checks passed.
- Emergency hotfixes (requires a follow-up ticket for test debt).

## Quality Bar

- **Readability**: Tests must serve as documentation for the feature.
- **Reliability**: Tests must be deterministic (no flakes) and decoupled from implementation internals.
