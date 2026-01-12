---
description: Show working tree changes (staged, unstaged, untracked)
---

# Diff Summary: Working Tree → HEAD

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
