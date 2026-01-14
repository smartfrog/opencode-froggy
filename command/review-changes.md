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

## Untracked Files Content
!`bash -c 'git ls-files --others --exclude-standard | while read f; do [ -f "$f" ] && echo "=== $f ===" && sed -n "1,50p" "$f" && sed -n "51p" "$f" | grep -q . && echo "... (truncated)"; done'`

Review the above changes for quality, correctness, and adherence to project guidelines.
