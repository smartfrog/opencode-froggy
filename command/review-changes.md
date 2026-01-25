---
description: Review uncommitted changes (staged + unstaged, incl. untracked diffs)
agent: code-reviewer
---

# Review: Working Tree → HEAD

## Status
!`git status --porcelain`

## Staged Changes
!`git diff --cached --stat`
!`git diff --cached`

## Unstaged Changes
!`git diff --stat`
!`git diff`

## Untracked Files (new)
These files are new and not yet tracked by git. Read them directly to see their content.
!`git ls-files --others --exclude-standard`

Review the above changes for quality, correctness, and adherence to project guidelines.
