---
name: extreme-programming
description: Apply XP principles through simple evolving design, short feedback loops, and shared engineering responsibility.
---

# Extreme Programming

- **Communication:** share objectives, acceptance examples, relevant context, and evidence so another agent can resume the work.
- **Simplicity:** apply KISS and YAGNI; reuse existing capabilities and evolve the simplest design meeting current needs.
- **Feedback:** verify assumptions early, integrate validated changes frequently, and adjust product decisions using actual user feedback. Use `tdd` for implementation and `backlog-management` for ticket workflow.
- **Courage:** report failed checks and uncertainty honestly; revise decisions when evidence changes.
- **Respect:** give specific, evidence-based feedback, preserve others' work, and bound investigation and correction costs.

Implementers own tests and ongoing refactoring. Reviewers and simplifiers provide targeted help. Follow shared project conventions; temporary scopes coordinate edits rather than establish permanent code ownership. A passing isolated branch is not proof of successful integration. Prefer reversible design decisions and distinguish production-ready changes from experimental findings.
