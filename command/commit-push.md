---
description: Commit and push changes
agent: build
---

## Context

- Current branch: !`git branch --show-current`

## Your task

1. Run `/diff-summary` to analyze all working tree changes
2. Present a summary to the user:
   - Files modified/added/deleted with stats
   - Proposed commit message based on the changes
3. **If the current branch is `master`, `main`, `develop`, or `dev`:**
   - Warn the user that committing directly to this branch is discouraged
   - Propose to create a new feature branch with a suggested name based on the changes
   - Ask the user if they want to: (a) create the suggested branch, (b) provide a custom branch name, or (c) continue on the current branch anyway
   - If the user chooses to create a branch, create it and switch to it before proceeding
4. Ask the user for confirmation before proceeding
5. Only if the user confirms:
   - Stage all changes (`git add -A`)
   - Create the commit with the agreed message
   - Push to origin on the current branch
   - Display the commit hash, message, and files committed
