---
name: tdd
description: >
  Apply Test-Driven Development workflow for new features, bugfixes, and refactors.
  Write failing tests first, implement minimal code to pass, then refactor.
  Use when the user asks to add a feature, fix a bug, write tests, ensure test coverage,
  do red-green-refactor, or follow TDD practices.
---

# TDD Protocol

Write tests first, then implement. Every feature or bugfix starts with a failing test.

## Process

### 1. Requirement synthesis

Summarize the expected behavior in 1-3 bullet points before writing any code or tests.

**Verify:** confirm understanding with the user if requirements are ambiguous.

### 2. Write failing tests (Red)

Write tests that describe the expected behavior. Choose the right test level:

| Level | When to use | Examples |
|---|---|---|
| Unit | Pure logic, isolated functions, data transformations | Validators, parsers, calculators |
| Integration | System interactions, API boundaries, DB queries | Service layers, API endpoints, repositories |
| E2E | Critical user journeys, full-stack flows | Login flow, checkout, onboarding |

```bash
# Run the new tests to confirm they fail
<test-runner> <test-file>
```

**Verify:** tests must fail for the right reason (missing implementation, not syntax errors or misconfiguration). If tests error instead of fail, fix the test setup first.

### 3. Implement (Green)

Write the minimum code required to make all failing tests pass. Do not add behavior beyond what tests require.

```bash
# Run tests again to confirm they pass
<test-runner> <test-file>
```

**Verify:** all new tests pass. If any test fails, fix the implementation (not the test) unless the test itself has a bug.

### 4. Refactor

Improve code quality while keeping all tests green. Run the full test suite after refactoring.

```bash
# Run full suite to catch regressions
<test-runner>
```

**Verify:** no regressions. If a test breaks during refactor, revert the refactor step and retry with a smaller change.

## Test quality rules

| Rule | Rationale |
|---|---|
| Test observable behavior, not internals | Survives refactoring without test changes |
| Each test has a single assertion focus | Clear failure messages, easier debugging |
| Tests must be deterministic | No flakes, no time/order dependencies |
| Tests serve as documentation | A new developer should understand the feature from tests alone |
| Use descriptive test names | Name should describe the scenario and expected outcome |

## Error recovery

| Problem | Action |
|---|---|
| Tests fail for wrong reason (import error, config) | Fix test infrastructure first, then re-run |
| Cannot determine correct test level | Default to unit tests; escalate to integration only when mocking becomes excessive |
| Existing tests break after implementation | Check if existing tests encode wrong behavior; if correct, fix implementation |
| Test runner not found or not configured | Check project for `package.json` scripts, `Makefile`, `pytest.ini`, or similar; ask user if unclear |
| Flaky test detected | Isolate non-determinism (time, network, concurrency); mock or pin the source |

## Exceptions

These scenarios may skip the test-first step. Each requires explicit justification:

| Exception | Required follow-up |
|---|---|
| Pure refactoring (identical behavior) | Run existing test suite to confirm no regressions |
| Exploratory spike / R&D | Create a follow-up ticket for test coverage |
| UI/styling changes with low test ROI | Verify manually; document what was checked |
| Emergency hotfix | Create a follow-up ticket for test debt within 24h |
