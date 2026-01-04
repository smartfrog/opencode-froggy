---
description: Update documentation based on uncommitted changes (new features only)
agent: doc-writer
---

## Analysis Phase

Use the `diff-summary` tool (without parameters) to get the working tree changes, then:

1. **Identify new features** in the changes:
   - New public APIs, functions, or methods
   - New configuration options
   - New CLI commands or flags
   - New behaviors or capabilities

2. **Filter for documentation-worthy changes**:
   - Skip internal refactors, bug fixes, or implementation details
   - Skip changes that don't affect user-facing behavior
   - Skip trivial changes (formatting, comments, renaming internals)

3. **If no documentation-worthy changes are found**, report this and stop.

## Documentation Discovery

Automatically detect documentation files in the project:
- Look for `README.md` at project root
- Look for `docs/` or `documentation/` directories
- Look for other `.md` files that describe usage, API, or features
- Check if `CHANGELOG.md` exists (do NOT create it if missing)

## Update Phase

For each documentation-worthy feature:
1. Identify which documentation file(s) should be updated
2. Apply minimal, targeted updates that document the new feature
3. Match the existing style and structure of the documentation
4. If `CHANGELOG.md` exists, add an entry for the new feature

## Constraints

- Only document features that are **complete and functional** in the diff
- Do NOT document planned or incomplete features
- Do NOT rewrite existing documentation sections
- Do NOT add documentation for internal implementation details
- Do NOT create `CHANGELOG.md` if it does not exist
