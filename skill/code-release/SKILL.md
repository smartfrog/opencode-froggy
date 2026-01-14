---
name: code-release
description: >
  Prepare and execute a release with version bumping, changelog updates, and tags.
use_when: >
  REQUIRED: When the user asks to prepare or perform a release,
  call skill({ name: "code-release" }) before changing any release artifacts.
---

# Code Release Skill

## CRITICAL CONSTRAINT

You MUST NOT change versions, tags, or publish without explicit user confirmation.
Any destructive or remote action requires confirmation, including:
- `git commit`
- `git tag`
- `git push`

## Step 1: Determine last released version

1. Prefer the latest Git tag that matches `v<semver>`.
2. If no matching tag exists, use the version in `package.json`.
3. Collect commits since the last version (tag to `HEAD`).

## Step 2: Propose version bump

Analyze commits since the last version and recommend a semver bump:
- **major**: breaking changes or incompatible behavior changes.
- **minor**: new features with backward compatibility.
- **patch**: fixes and internal changes only.

Present the recommendation and ask the user to confirm before changing any files.

## Step 3: Update release artifacts (after confirmation)

- Update the version in `package.json`.
- Update `CHANGELOG` with a new section for the version.
- Summarize changes based on the commit range.
- Preserve the existing changelog format.

## Step 4: Tag and publish (after confirmation)

- Commit release changes with a clear release message.
- Create an annotated tag (for example, `vX.Y.Z`).
- Push commits, then push tags.

## Output format

- Summary of the last version, commit range, and recommended bump.
- Explicit confirmation request before making changes.
- After completion, list commands run.
