---
description: Review changes from source branch into target branch
agent: code-reviewer
---

# Review: origin/$1 → origin/$2

CONSTRAINTS:
- Base analysis ONLY on git outputs below and AGENTS.md (if present)
- For more context: request `-U10` or `git show "origin/$2:<path>"`
- Local working tree may differ from origin branches

## 1. Fetch latest
!`git fetch origin "$1" "$2" --prune`

## 2. Stats overview
!`git diff --stat "origin/$2...origin/$1"`

## 3. Commits to review
!`git log --oneline --no-merges "origin/$2..origin/$1"`

## 4. Files changed
!`git diff --name-only "origin/$2...origin/$1"`

## 5. Project rules (if any)
!`git show "origin/$2:AGENTS.md" 2>/dev/null || echo "No AGENTS.md in target branch"`

## 6. Full diff
!`git diff -U5 --function-context "origin/$2...origin/$1"`
