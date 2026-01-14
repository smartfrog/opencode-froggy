---
name: code-simplify
description: >
  Simplify code you just wrote or modified. Load after completing a feature, fix, or refactor 
  to improve clarity while preserving behavior.
use_when: >
  REQUIRED: After completing a coding task (feature, bug fix, refactor) where code files were modified,
  call skill({ name: "code-simplify" }) as a final quality check BEFORE marking the task complete.
  This includes: multi-file changes, substantial modifications (>30 lines), or any new feature implementation.
---

Run the `/simplify-changes` command.
