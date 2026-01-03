---
description: Review uncommitted changes (staged + unstaged, incl. untracked diffs)
agent: code-reviewer
---

# Review: Working Tree → HEAD

CONSTRAINTS:
- Base analysis ONLY on git outputs below and AGENTS.md (if present)
- For more context: request `-U10` or `git show "HEAD:<path>"`
- Untracked files are shown via `git diff --no-index` (working tree only)

## 1. Status overview
!`git status --porcelain=v1 -uall`

## 2. Staged changes (will be committed)
!`git diff --cached --stat`
!`git diff --cached --name-status`
!`git diff --cached -U5 --function-context`

## 3. Unstaged changes (won't be committed yet)
!`git diff --stat`
!`git diff --name-status`
!`git diff -U5 --function-context`

## 4. Untracked (new) files: list + diff (even if not staged)
!`git ls-files --others --exclude-standard || true`
!`git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do echo "=== NEW: $f ==="; git diff --no-index -U5 --function-context -- /dev/null "$f" || true; echo; done`
