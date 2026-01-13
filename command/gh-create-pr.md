---
description: Commit, push and create a GitHub PR
agent: build
---

## Context

- Current branch: !`git branch --show-current`
- Default branch: !`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`

## Your task

1. Execute `/commit-push` to commit and push all changes
2. Once the push is complete, create a PR using `gh pr create`:
   - Use the commit message as PR title
   - Generate a brief PR description summarizing the changes
   - Target the repository's default branch
3. Display the PR URL to the user
