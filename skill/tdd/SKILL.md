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
2. **Test Specification**: Write tests describing the expected behavior (unit, integration, or E2E).
3. **Implementation**: Update the logic only to the extent required to satisfy those tests.

## Mandatory Rules

- **No Test, No Code**: Every new feature or bugfix must include relevant test coverage.
- **Black-Box Testing**: Validate observable behavior, not internal implementation details.
- **Merge Requirement**: Tests are mandatory for completion unless an explicit exception is documented.

## Preferred Practice

- **Red-Green-Refactor**: Start with a failing test whenever practical.
- **Right-Sized Testing**:
  - **Unit Tests**: For pure logic and isolated functions.
  - **Integration Tests**: For system interactions and API boundaries.
  - **E2E Tests**: For critical user journeys and "happy paths."

## Explicit Exceptions (Must be justified)

- Pure refactoring (where behavior remains identical).
- Exploratory spikes or R&D.
- UI/Styling iterations where unit tests offer diminishing returns.
- Complex integrations where mocking is counterproductive.
- Emergency hotfixes (requires a follow-up ticket for test debt).

## Quality Bar

- **Readability**: Tests must serve as documentation for the feature.
- **Reliability**: Tests must be deterministic (no flakes) and decoupled from implementation internals.
