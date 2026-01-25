---
description: Prepare and execute a release with version bumping, changelog updates, and tags
---

## Context

- Current version: !`git describe --tags --abbrev=0 2>/dev/null || echo "0.0.0"`
- Commits since last tag: !`git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~10")..HEAD --oneline 2>/dev/null || git log --oneline -10`

## CRITICAL CONSTRAINT

You MUST NOT change versions, tags, or publish without explicit user confirmation.
Any destructive or remote action requires confirmation, including:
- `git commit`
- `git tag`
- `git push`

## Your task

### Step 1: Determine last released version

1. Use the latest Git tag that matches `v<semver>` or `<semver>`.
2. If no tag exists, consider this the first release (`0.0.0`).
3. Collect commits since the last version (tag to `HEAD`).

### Step 2: Propose version bump

Analyze commits since the last version and recommend a semver bump:
- **major**: breaking changes or incompatible behavior changes.
- **minor**: new features with backward compatibility.
- **patch**: fixes and internal changes only.

Present the recommendation and ask the user to confirm before changing any files.

### Step 3: Update release artifacts (after confirmation)

- Update `CHANGELOG` with a new section for the version.
- Summarize changes based on the commit range.
- Preserve the existing changelog format.
- Auto-detect and update the version file if present:
  - Node.js: `package.json`
  - Python: `pyproject.toml` or `setup.py`
  - Rust: `Cargo.toml`
  - PHP: `composer.json`
  - Ruby: `*.gemspec`
  - Go: tags only (no version file)

### Step 4: Tag and publish (after confirmation)

- Commit release changes with a clear release message.
- Create an annotated tag (for example, `vX.Y.Z`).
- Push commits, then push tags.

## Output format

- Summary of the last version, commit range, and recommended bump.
- Explicit confirmation request before making changes.
- After completion, list commands run.
