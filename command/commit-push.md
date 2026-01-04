---
description: Commit and push changes
agent: build
---

## Context

- Current branch: !`git branch --show-current`

## Your task

1. Use the `diff-summary` tool (without parameters) to analyze all working tree changes
2. Present a summary to the user:
   - Files modified/added/deleted with stats
   - Proposed commit message based on the changes
3. Ask the user for confirmation before proceeding
4. Only if the user confirms:
   - Stage all changes (`git add -A`)
   - Create the commit with the agreed message
   - Push to origin on the current branch
   - Display the commit hash, message, and files committed
