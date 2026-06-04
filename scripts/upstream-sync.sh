#!/bin/bash
# autolycus-upstream-sync.sh
# Fetches upstream and MERGES our fork with upstream/main.
#
# Strategy: merge (not rebase) — preserves all fork commit SHAs,
# creates one merge commit per sync cycle, normal push (no force).
#
#   1. Merge upstream/main into our branch
#   2. Resolve conflicts keeping BOTH sides where needed
#   3. Post-merge: verify fork-specific markers exist; patch them back if missing
#   4. Normal git push — always fast-forward compatible

set -e

REPO_DIR="$HOME/compiled/autolycus-agent"
cd "$REPO_DIR"

# === Fork-specific files and their content markers ===
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

# Fetch latest upstream
git fetch upstream

# Check if upstream has new commits
AHEAD=$(git rev-list HEAD..upstream/main --count 2>/dev/null || echo "0")

if [ "$AHEAD" -eq 0 ]; then
    echo "[SILENT]"
    exit 0
fi

echo "Found $AHEAD new upstream commits. Merging..."

# === STEP 1: Commit any uncommitted changes before merging ===
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo "Uncommitted changes detected, committing before merge..."
    git add -A
    git commit -m "upstream-sync: pre-merge stash $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty || true
fi

# === STEP 2: Merge upstream/main ===
MERGE_OUTPUT=$(git merge upstream/main --no-edit 2>&1) || {
    echo ""
    echo "=================================================="
    echo "  MERGE CONFLICT DETECTED — auto-resolving"
    echo "=================================================="
    echo ""

    # Resolve conflicts: keep both sides, strip markers
    CONFLICT_FILES=$(git diff --name-only --diff-filter=U)
    for file in $CONFLICT_FILES; do
        echo "Resolving conflict in: $file"
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
        git add "$file"
    done

    GIT_EDITOR=true git merge --continue 2>&1 || {
        echo "ERROR: Could not complete merge resolution!"
        exit 1
    }
}

# === STEP 3: Clean up any remaining conflict markers ===
for f in $(grep -rl "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" --include="*.toml" --include="*.yml" --include="*.md" . 2>/dev/null); do
    sed -i '/^<<<<<<<\|^=======\|^>>>>>>>.*$/d' "$f"
    echo "Cleaned conflict markers from: $f"
done

REMAINING=$(grep -r "^<<<<<<<\|^=======\|^>>>>>>>" --include="*.py" --include="*.toml" --include="*.yml" --include="*.md" . 2>/dev/null | wc -l || echo "0")
if [ "$REMAINING" -gt 0 ]; then
    echo "WARNING: $REMAINING conflict markers still remain!"
    exit 1
fi

# === STEP 4: Verify fork-specific markers exist; patch if missing ===
echo "Checking fork-specific file integrity..."
PATCHES_APPLIED=0
for entry in "${FORK_FILES[@]}"; do
    filepath="${entry%%|*}"
    marker="${entry##*|}"
    if grep -q "$marker" "$filepath" 2>/dev/null; then
        echo "  OK: $filepath (has '$marker')"
    else
        echo "  MISSING: $filepath (lost '$marker') — will patch after loop"
        PATCHES_APPLIED=$((PATCHES_APPLIED + 1))
    fi
done

# Apply patches for missing markers
if [ "$PATCHES_APPLIED" -gt 0 ]; then
    echo "Patching missing fork-specific markers..."

    # For pyproject.toml — ensure lycus and LGPL markers
    if ! grep -q "lycus" pyproject.toml 2>/dev/null; then
        echo "  Patching pyproject.toml: adding lycus reference"
        sed -i 's/name = "hermes-agent"/name = "lycus-agent"/' pyproject.toml || true
    fi
    if ! grep -q "LGPL" pyproject.toml 2>/dev/null; then
        echo "  Patching pyproject.toml: adding LGPL license"
        sed -i 's/license = ".*"/license = "LGPL-3.0"/' pyproject.toml || true
    fi

    # For README.md — restore Autolycus branding if missing
    if ! grep -q "Autolycus" README.md 2>/dev/null; then
        echo "  WARNING: README.md lost Autolycus marker — manual review needed"
    fi

    # For install scripts — restore if markers missing
    if ! grep -q "freebsd" scripts/install.sh 2>/dev/null; then
        echo "  WARNING: scripts/install.sh lost FreeBSD support — manual review needed"
    fi
    if ! grep -q "Autolycus" scripts/install-autolycus.sh 2>/dev/null; then
        echo "  WARNING: install-autolycus.sh lost Autolycus branding — manual review needed"
    fi

    # For code files that may have been overwritten by upstream
    if ! grep -q "def build_plan_path" agent/skill_commands.py 2>/dev/null; then
        echo "  WARNING: build_plan_path missing from skill_commands.py — manual review needed"
    fi
    if ! grep -q "def custom_provider_slug" hermes_cli/providers.py 2>/dev/null; then
        echo "  WARNING: custom_provider_slug missing from providers.py — manual review needed"
    fi
fi

# === STEP 5: Enforce Autolycus branding — replace Hermes medical staff with trident ===
STAFF_COUNT=$(grep -r '⚕' --include='*.py' --include='*.md' --include='*.toml' --include='*.yml' . 2>/dev/null | grep -v venv | wc -l || echo "0")
if [ "$STAFF_COUNT" -gt 0 ]; then
    echo "Enforcing trident branding: replacing $STAFF_COUNT medical staff symbol(s)..."
    find . -type f \( -name '*.py' -o -name '*.md' -o -name '*.toml' -o -name '*.yml' \) \
        -not -path './venv/*' -not -path './.venv/*' -not -path './tracking/venv/*' \
        -exec sed -i 's/⚕/🔱/g' {} +
    echo "  Trident branding enforced."
else
    echo "  OK: No medical staff symbols found (trident branding intact)."
fi

# === STEP 6: Post-sync patches — remove Windows-specific files ===
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

# === STEP 7: Commit and push (NO force) ===
git add -A
HAS_CHANGES=$(git diff --cached --quiet 2>/dev/null && echo "0" || echo "1")

if [ "$HAS_CHANGES" = "1" ]; then
    git commit -m "upstream-sync: merge with post-sync patches $(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

# Normal push — no force. If upstream moved our branch (shouldn't happen), fail safely.
git push origin main || {
    echo "ERROR: Push failed! This may mean someone else pushed to the same branch."
    echo "Resolve manually or run: git pull --rebase && git push"
    exit 1
}

echo ""
echo "Sync complete. Fork merged with upstream/main ($AHEAD new commits incorporated)."
echo "Pushed normally — no history rewrite."
