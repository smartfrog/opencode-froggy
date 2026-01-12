---
description: Review changes from source branch into target branch
agent: code-reviewer
---

# Review: $1 → $2

## Fetch latest
!`git fetch --all --prune 2>/dev/null || true`

## Stats Overview
!`git diff --stat $2...$1`

## Commits to Review
!`git log --oneline --no-merges $2..$1`

## Files Changed
!`git diff --name-only $2...$1`

## Full Diff
!`git diff -U5 --function-context $2...$1`

Review the above changes for quality, correctness, and adherence to project guidelines.
