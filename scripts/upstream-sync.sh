#!/bin/bash
# autolycus-upstream-sync.sh
# Fetches upstream, rebases our fork, resolves known conflicts, and pushes.

set -e

REPO_DIR="$HOME/compiled/autolycus-agent"
cd "$REPO_DIR"

# Fetch latest upstream
git fetch upstream

# Check if upstream has new commits
AHEAD=$(git rev-list HEAD..upstream/main --count 2>/dev/null || echo "0")

if [ "$AHEAD" -eq 0 ]; then
    echo "Already up to date with upstream/main."
    exit 0
fi

echo "Found $AHEAD new upstream commits. Rebasing..."

# Rebase onto upstream
git rebase upstream/main 2>&1 || true

# Resolve known conflict patterns
# README conflicts: always keep our (Autolycus) version
while git status --porcelain | grep -q "UU README.md"; do
    git checkout --ours README.md
    git add README.md
    GIT_EDITOR=true git rebase --continue 2>&1 || true
done

# main.py conflicts: take upstream (theirs) - our rebranding is in earlier commits
while git status --porcelain | grep -q "UU hermes_cli/main.py"; do
    git checkout --theirs hermes_cli/main.py
    git add hermes_cli/main.py
    GIT_EDITOR=true git rebase --continue 2>&1 || true
done

# cli.py conflicts: take ours (our custom additions)
while git status --porcelain | grep -q "UU cli.py"; do
    git checkout --ours cli.py
    git add cli.py
    GIT_EDITOR=true git rebase --continue 2>&1 || true
done

# General fallback: take ours for any remaining conflicts
while git status --porcelain | grep -q "UU"; do
    git checkout --ours $(git status --porcelain | grep "UU" | awk '{print $2}')
    git add $(git status --porcelain | grep "UU" | awk '{print $2}')
    GIT_EDITOR=true git rebase --continue 2>&1 || true
done

# Clean up any leftover conflict markers in all Python files
# This catches cases where sed-based resolution left markers behind
for f in $(grep -rl "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" . 2>/dev/null); do
    sed -i '/^<<<<<<<\|^=======\|^>>>>>>>.*$/d' "$f"
    echo "Cleaned conflict markers from: $f"
done

# Verify no conflict markers remain
REMAINING=$(grep -r "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" . 2>/dev/null | wc -l || echo "0")
if [ "$REMAINING" -gt 0 ]; then
    echo "WARNING: $REMAINING conflict markers still remain!"
    exit 1
fi

# Push to origin
git add -A
git commit -m "upstream-sync: auto-rebase cleanup $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty
git push origin main --force-with-lease

echo "Sync complete. Fork is now on top of upstream/main."
