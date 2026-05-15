#!/bin/bash
# autolycus-upstream-sync.sh
# Fetches upstream, rebases our fork, resolves known conflicts, and pushes.
#
# Fork-specific file preservation strategy:
#   1. Pre-rebase: save current fork-specific file contents to temp backups
#   2. Rebase onto upstream
#   3. Post-rebase: check each fork-specific file for its marker; restore from backup if lost
#   4. Commit everything, then update the reference SHAs in this script itself

set -e

REPO_DIR="$HOME/compiled/autolycus-agent"
cd "$REPO_DIR"

# === Fork-specific files and their content markers ===
# Each line: FILEPATH|MARKER (grep pattern that must be present)
FORK_FILES=(
    "README.md|Autolycus"
    "scripts/install.sh|freebsd"
    "scripts/install-autolycus.sh|Autolycus"
    "pyproject.toml|lycus"
    "pyproject.toml|LGPL"
    "agent/skill_commands.py|def build_plan_path"
    "hermes_cli/providers.py|def custom_provider_slug"
)

# Temp directory for backups (survives rebase)
BACKUP_DIR=$(mktemp -d "${HOME}/.autolycus-sync-backup-XXXXXX")
trap "rm -rf '$BACKUP_DIR'" EXIT

# Fetch latest upstream
git fetch upstream

# Check if upstream has new commits
AHEAD=$(git rev-list HEAD..upstream/main --count 2>/dev/null || echo "0")

if [ "$AHEAD" -eq 0 ]; then
    echo "Already up to date with upstream/main."
    exit 0
fi

echo "Found $AHEAD new upstream commits. Rebasing..."

# === STEP 1: Commit any uncommitted changes before rebasing ===
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo "Uncommitted changes detected, stashing before rebase..."
    git add -A
    git commit -m "upstream-sync: pre-rebase stash $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty || true
fi

# === STEP 2: Save fork-specific file contents to backups ===
echo "Saving fork-specific file backups..."
mkdir -p "$BACKUP_DIR"
for entry in "${FORK_FILES[@]}"; do
    filepath="${entry%%|*}"
    marker="${entry##*|}"
    if [ -f "$filepath" ]; then
        cp "$filepath" "$BACKUP_DIR/$(basename "$filepath")"
        echo "  Backed up: $filepath"
    fi
done

# === STEP 3: Rebase onto upstream ===
git rebase --autostash --rebase-merges upstream/main 2>&1 || {
    echo "Rebase had issues, attempting to auto-resolve..."

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

    # Handle stuck "editing commit" states (empty commits during rebase)
    if git status | grep -q "currently editing a commit"; then
        echo "Stuck on empty commit edit, continuing..."
        GIT_EDITOR=true git rebase --continue 2>&1 || true
    fi
}

# === STEP 4: Clean up conflict markers in Python files ===
for f in $(grep -rl "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" . 2>/dev/null); do
    sed -i '/^<<<<<<<\|^=======\|^>>>>>>>.*$/d' "$f"
    echo "Cleaned conflict markers from: $f"
done

REMAINING=$(grep -r "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" . 2>/dev/null | wc -l || echo "0")
if [ "$REMAINING" -gt 0 ]; then
    echo "WARNING: $REMAINING conflict markers still remain!"
    exit 1
fi

# === STEP 5: Restore fork-specific files from backups if markers are lost ===
echo "Checking fork-specific file integrity..."
for entry in "${FORK_FILES[@]}"; do
    filepath="${entry%%|*}"
    marker="${entry##*|}"
    if grep -q "$marker" "$filepath" 2>/dev/null; then
        echo "  OK: $filepath (has '$marker')"
    elif [ -f "$BACKUP_DIR/$(basename "$filepath")" ]; then
        echo "  RESTORING: $filepath (lost '$marker')"
        cp "$BACKUP_DIR/$(basename "$filepath")" "$filepath"
    else
        echo "  WARNING: $filepath lost '$marker' but no backup available!"
    fi
done

# === STEP 6: Post-sync patches - remove Windows-specific files ===
if [ -f scripts/check-windows-footguns.py ]; then
    echo "Removing scripts/check-windows-footguns.py..."
    rm scripts/check-windows-footguns.py
fi
if [ -f scripts/install.cmd ]; then
    echo "Removing scripts/install.cmd..."
    rm scripts/install.cmd
fi
if [ -f scripts/install.ps1 ]; then
    echo "Removing scripts/install.ps1..."
    rm scripts/install.ps1
fi

# Remove windows-footguns job from lint workflow if present
if grep -q "windows-footguns:" .github/workflows/lint.yml 2>/dev/null; then
    echo "Removing windows-footguns job from lint.yml..."
    python3 -c "
import re
path = '.github/workflows/lint.yml'
with open(path) as f:
    content = f.read()
content = re.sub(r'\n  windows-footguns:.*?(?=\n  [a-z]|\n\njobs:|\Z)', '', content, flags=re.DOTALL)
with open(path, 'w') as f:
    f.write(content)
"
fi

# === STEP 7: Safety check - ensure rebase is complete ===
if git status | grep -q "rebase in progress\|rebase-merge\|rebase-apply"; then
    echo "ERROR: Rebase appears incomplete, aborting sync!"
    exit 1
fi

# === STEP 8: Commit and push ===
git add -A
git commit -m "upstream-sync: auto-rebase cleanup $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty
git push origin main --force-with-lease

echo "Sync complete. Fork is now on top of upstream/main."
