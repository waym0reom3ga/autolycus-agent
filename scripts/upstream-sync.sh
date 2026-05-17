#!/bin/bash
# autolycus-upstream-sync.sh
# Fetches upstream, rebases our fork, resolves conflicts keeping BOTH sides, and pushes.
#
# Strategy:
#   1. Rebase onto upstream - Git automatically merges non-conflicting changes
#   2. For actual conflicts: keep content from BOTH ours and theirs (strip markers only)
#   3. Post-rebase: verify fork-specific markers exist; patch them back if missing

set -e

REPO_DIR="$HOME/compiled/autolycus-agent"
cd "$REPO_DIR"

# === Fork-specific files and their content markers ===
# Each line: FILEPATH|MARKER (grep pattern that must be present after sync)
FORK_FILES=(
    "README.md|Autolycus"
    "scripts/install.sh|freebsd"
    "scripts/install-autolycus.sh|Autolycus"
    "pyproject.toml|lycus"
    "pyproject.toml|LGPL"
    "agent/skill_commands.py|def build_plan_path"
    "hermes_cli/providers.py|def custom_provider_slug"
    "hermes_cli/skin_engine.py|Autolycus"
    "hermes_cli/banner.py|AUTOLYCUS"
    "hermes_cli/default_soul.py|Autolycus"
    "ui-tui/src/theme.ts|Autolycus"
    "ui-tui/src/components/branding.tsx|Autolycus"
    "ui-tui/src/app/useMainApp.ts|Autolycus"
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
    echo "Uncommitted changes detected, committing before rebase..."
    git add -A
    git commit -m "upstream-sync: pre-rebase stash $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty || true
fi

# === STEP 2: Save fork-specific file contents to backups ===
echo "Saving fork-specific file backups..."
mkdir -p "$BACKUP_DIR"
for entry in "${FORK_FILES[@]}"; do
    filepath="${entry%%|*}"
    if [ -f "$filepath" ]; then
        cp "$filepath" "$BACKUP_DIR/$(basename "$filepath")"
        echo "  Backed up: $filepath"
    fi
done

# === STEP 3: Rebase onto upstream ===
# --autostash handles uncommitted changes, --rebase-merges preserves merge structure
REBASE_OUTPUT=$(git rebase --autostash --rebase-merges upstream/main 2>&1) || {
    echo ""
    echo "=================================================="
    echo "  REBASE CONFLICT DETECTED - ANALYSIS REQUIRED"
    echo "=================================================="
    echo ""

    # Process each conflict interactively
    while git status --porcelain | grep -q "^UU"; do
        CONFLICT_FILES=$(git status --porcelain | grep "^UU" | awk '{print $2}')

        for file in $CONFLICT_FILES; do
            echo "=================================================="
            echo "  CONFLICT: $file"
            echo "=================================================="
            echo ""
            echo "Current commit being rebased:"
            git log -1 --oneline
            echo ""
            echo "Upstream changes to this file:"
            git diff --theirs "$file" | head -100
            echo ""
            echo "Our fork changes to this file:"
            git diff --ours "$file" | head -100
            echo ""
            echo "=================================================="
            echo "Please analyze this conflict and decide:"
            echo "  [O] Keep ours (fork changes)"
            echo "  [T] Keep theirs (upstream changes)"
            echo "  [B] Keep both (merge manually)"
            echo "  [E] Edit file manually"
            echo "=================================================="
            read -r decision

            case $decision in
                O|o)
                    echo "Keeping ours for $file"
                    git checkout --ours "$file"
                    ;;
                T|t)
                    echo "Keeping theirs for $file"
                    git checkout --theirs "$file"
                    ;;
                B|b)
                    echo "Merging both sides for $file"
                    # Keep content from both, strip markers
                    python3 -c "
with open('$file', 'r') as f:
    lines = f.readlines()

result = []
in_theirs = False
for line in lines:
    if line.startswith('<<<<<<<'):
        in_theirs = False
        continue
    elif line.startswith('======='):
        in_theirs = True
        continue
    elif line.startswith('>>>>>>>'):
        in_theirs = False
        continue
    else:
        result.append(line)

with open('$file', 'w') as f:
    f.writelines(result)
"
                    ;;
                E|e)
                    echo "Opening editor for $file"
                    $EDITOR "$file"
                    ;;
                *)
                    echo "Invalid decision, keeping ours as default"
                    git checkout --ours "$file"
                    ;;
            esac

            git add "$file"
        done

        # Continue rebase after resolving all conflicts for this commit
        GIT_EDITOR=true git rebase --continue 2>&1 || break
    done
}

# === STEP 4: Clean up any remaining conflict markers ===
for f in $(grep -rl "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" --include="*.toml" --include="*.yml" --include="*.md" . 2>/dev/null); do
    sed -i '/^<<<<<<<\|^=======\|^>>>>>>>.*$/d' "$f"
    echo "Cleaned conflict markers from: $f"
done

REMAINING=$(grep -r "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" --include="*.toml" --include="*.yml" --include="*.md" . 2>/dev/null | wc -l || echo "0")
if [ "$REMAINING" -gt 0 ]; then
    echo "WARNING: $REMAINING conflict markers still remain!"
    exit 1
fi

# === STEP 5: Verify fork-specific markers exist; patch if missing ===
echo "Checking fork-specific file integrity..."
PATCHES_APPLIED=0
for entry in "${FORK_FILES[@]}"; do
    filepath="${entry%%|*}"
    marker="${entry##*|}"
    if grep -q "$marker" "$filepath" 2>/dev/null; then
        echo "  OK: $filepath (has '$marker')"
    else
        echo "  MISSING: $filepath (lost '$marker') - will patch after loop"
        PATCHES_APPLIED=$((PATCHES_APPLIED + 1))
    fi
done

# Apply patches for missing markers using our backup as reference
if [ "$PATCHES_APPLIED" -gt 0 ]; then
    echo "Patching missing fork-specific markers..."

    # For skill_commands.py - ensure build_plan_path function exists
    if ! grep -q "def build_plan_path" agent/skill_commands.py 2>/dev/null; then
        if [ -f "$BACKUP_DIR/skill_commands.py" ]; then
            echo "  Restoring build_plan_path to agent/skill_commands.py"
            # Extract the function from backup and insert it
            python3 << 'PYEOF'
import re

backup = "$BACKUP_DIR/skill_commands.py"
target = "agent/skill_commands.py"

with open(backup) as f:
    backup_content = f.read()
with open(target) as f:
    target_content = f.read()

# Extract build_plan_path function from backup
match = re.search(r'(def build_plan_path\(.*?\n(?:    .*\n|\n)*?)(?=\n\w|\Z)', backup_content, re.DOTALL)
if match:
    func = match.group(1)
    # Insert before the next function definition or at the end
    if 'def build_plan_path' not in target_content:
        # Find a good insertion point (after imports, before other functions)
        insert_pos = target_content.find('def ')
        if insert_pos == -1:
            target_content = func + '\n\n' + target_content
        else:
            target_content = target_content[:insert_pos] + func + '\n\n' + target_content[insert_pos:]
        with open(target, 'w') as f:
            f.write(target_content)
        print("  Patched: build_plan_path added")
PYEOF
        fi
    fi

    # For providers.py - ensure custom_provider_slug function exists
    if ! grep -q "def custom_provider_slug" hermes_cli/providers.py 2>/dev/null; then
        if [ -f "$BACKUP_DIR/providers.py" ]; then
            echo "  Restoring custom_provider_slug to hermes_cli/providers.py"
            python3 << 'PYEOF'
import re

backup = "$BACKUP_DIR/providers.py"
target = "hermes_cli/providers.py"

with open(backup) as f:
    backup_content = f.read()
with open(target) as f:
    target_content = f.read()

match = re.search(r'(def custom_provider_slug\(.*?\n(?:    .*\n|\n)*?)(?=\n\w|\Z)', backup_content, re.DOTALL)
if match:
    func = match.group(1)
    if 'def custom_provider_slug' not in target_content:
        insert_pos = target_content.find('def ')
        if insert_pos == -1:
            target_content = func + '\n\n' + target_content
        else:
            target_content = target_content[:insert_pos] + func + '\n\n' + target_content[insert_pos:]
        with open(target, 'w') as f:
            f.write(target_content)
        print("  Patched: custom_provider_slug added")
PYEOF
        fi
    fi

    # For pyproject.toml - ensure lycus and LGPL markers
    if ! grep -q "lycus" pyproject.toml 2>/dev/null; then
        echo "  Patching pyproject.toml: adding lycus reference"
        sed -i 's/name = "hermes-agent"/name = "lycus-agent"/' pyproject.toml || true
    fi
    if ! grep -q "LGPL" pyproject.toml 2>/dev/null; then
        echo "  Patching pyproject.toml: adding LGPL license"
        sed -i 's/license = ".*"/license = "LGPL-3.0"/' pyproject.toml || true
    fi

    # For README.md - restore Autolycus branding if missing
    if ! grep -q "Autolycus" README.md 2>/dev/null && [ -f "$BACKUP_DIR/README.md" ]; then
        echo "  Restoring Autolycus branding in README.md"
        cp "$BACKUP_DIR/README.md" README.md
    fi

    # For install scripts - restore if markers missing
    if ! grep -q "freebsd" scripts/install.sh 2>/dev/null && [ -f "$BACKUP_DIR/install.sh" ]; then
        echo "  Restoring FreeBSD support in scripts/install.sh"
        cp "$BACKUP_DIR/install.sh" scripts/install.sh
    fi
    if ! grep -q "Autolycus" scripts/install-autolycus.sh 2>/dev/null && [ -f "$BACKUP_DIR/install-autolycus.sh" ]; then
        echo "  Restoring Autolycus branding in scripts/install-autolycus.sh"
        cp "$BACKUP_DIR/install-autolycus.sh" scripts/install-autolycus.sh
    fi
fi

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
git commit -m "upstream-sync: auto-rebase with both-sides conflict resolution $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty
git push origin main --force-with-lease

echo "Sync complete. Fork is now on top of upstream/main."
