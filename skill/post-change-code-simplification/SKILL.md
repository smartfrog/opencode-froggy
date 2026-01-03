---
name: post-change-code-simplification
description: Enforce systematic code simplification after any code modification using git-diff-based scope
license: MIT
compatibility: opencode
metadata:
  audience: engineers
  workflow: build
---

# Post-Change Code Simplification

## What I Do

- Define a strict, git-diff-based input contract so simplification stays scoped to the actual changes
- Ensure newly written or modified code is simplified for clarity and maintainability **without changing behavior**

---

## Instructions

### Step 1 — Gather Git Diffs

Run these commands to collect the scope of changes:

#### Status Overview

```bash
git status --porcelain=v1 -uall
```

#### Staged Changes

```bash
git diff --cached --stat
git diff --cached --name-status
git diff --cached -U5 --function-context
```

#### Unstaged Changes

```bash
git diff --stat
git diff --name-status
git diff -U5 --function-context
```

#### Untracked Files

```bash
git ls-files --others --exclude-standard || true

git ls-files --others --exclude-standard -z | while IFS= read -r -d '' f; do
  echo "=== NEW: $f ==="
  git diff --no-index -U5 --function-context -- /dev/null "$f" || true
  echo
done
```

---

### Step 2 — Invoke Code Simplifier Agent

Call the **Code Simplifier Agent** (subagent type: `code-simplifier`) with all git outputs above.

---

## Constraints

- Simplify **only** code visible in the diffs
- Strictly preserve behavior (APIs, return values, side effects, execution order)
- If no simplification is possible, return with no changes
