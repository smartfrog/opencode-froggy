---
description: Show working tree changes or diff between branches ($1=source, $2=target)
---

# Diff Summary

Branch arguments (if provided): source=$1 target=$2

!`bash -c '
SOURCE="$1"
TARGET="$2"
TARGET="${TARGET:-HEAD}"

valid_ref() {
  case "$REF" in
    ""|-*) return 1 ;;
  esac
  git rev-parse --verify --quiet "$REF^{commit}" >/dev/null
}

if [ -n "$SOURCE" ]; then
  REF="$SOURCE"
  if ! valid_ref; then
    echo "Invalid source ref: $SOURCE"
    exit 0
  fi
  REF="$TARGET"
  if ! valid_ref; then
    echo "Invalid target ref: $TARGET"
    exit 0
  fi
  echo "## Branch Comparison: $SOURCE → $TARGET"
  echo ""
  git fetch --all --prune 2>/dev/null || true

  echo "### Stats Overview"
  git diff --stat "$TARGET"..."$SOURCE" --

  echo ""
  echo "### Commits"
  git log --oneline --no-merges "$TARGET".."$SOURCE" --

  echo ""
  echo "### Files Changed"
  git diff --name-only "$TARGET"..."$SOURCE" --

  echo ""
  echo "### Full Diff"
  git diff "$TARGET"..."$SOURCE" --
else
  echo "## Status"
  git status --porcelain

  echo ""
  echo "## Staged Changes"
  git diff --cached --stat
  git diff --cached

  echo ""
  echo "## Unstaged Changes"
  git diff --stat
  git diff

  echo ""
  echo "## Untracked Files (new)"
  echo "These files are new and not yet tracked by git. Read them directly to see their content."
  git ls-files --others --exclude-standard
fi
'`
