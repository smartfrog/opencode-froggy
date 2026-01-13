---
description: Show working tree changes or diff between branches ($1=source, $2=target)
---

# Diff Summary

!`bash -c '
SOURCE="$1"
TARGET="$2"
TARGET="${TARGET:-HEAD}"

if [ -n "$SOURCE" ]; then
  echo "## Branch Comparison: $SOURCE → $TARGET"
  echo ""
  git fetch --all --prune 2>/dev/null || true
  
  echo "### Stats Overview"
  git diff --stat "$TARGET"..."$SOURCE"
  
  echo ""
  echo "### Commits"
  git log --oneline --no-merges "$TARGET".."$SOURCE"
  
  echo ""
  echo "### Files Changed"
  git diff --name-only "$TARGET"..."$SOURCE"
  
  echo ""
  echo "### Full Diff"
  git diff "$TARGET"..."$SOURCE"
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
  echo "## Untracked Files Content"
  git ls-files --others --exclude-standard | while read f; do
    [ -f "$f" ] && echo "=== $f ===" && sed -n "1,50p" "$f" && sed -n "51p" "$f" | grep -q . && echo "... (truncated)"
  done
fi
'`
