---
name: code-simplify
description: >
  Simplify code you just wrote or modified. Load after completing a feature, fix, or refactor 
  to improve clarity while preserving behavior.
use_when: >
  CRITICAL REMINDER - DO NOT SKIP: You MUST call skill({ name: "code-simplify" }) IMMEDIATELY
  after ANY code modification (new files, edits, refactors), BEFORE responding to the user or
  marking todos complete. This is NOT optional. If you just wrote or modified code and are about
  to say "done" or ask "shall I commit?", STOP and call this skill FIRST. Failure to do so is
  a protocol violation.
---

Run the `/simplify-changes` command.
