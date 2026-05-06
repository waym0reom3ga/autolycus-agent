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

# Restore Autolycus README branding if lost
if ! grep -q "Autolycus" README.md 2>/dev/null; then
    echo "Restoring Autolycus README branding..."
    git show 4f1a47282:README.md > README.md
fi

# Preserve our custom build_plan_path function if it was lost during rebase
# (upstream removed it but our cli.py TUI still needs it)
if ! grep -q "def build_plan_path" agent/skill_commands.py 2>/dev/null; then
    echo "Restoring build_plan_path function to agent/skill_commands.py..."
    # Add datetime import if missing
    if ! grep -q "from datetime import datetime" agent/skill_commands.py; then
        sed -i 's/^from pathlib import Path$/from datetime import datetime\nfrom pathlib import Path/' agent/skill_commands.py
    fi
    # Add the function after _SKILL_MULTI_HYPHEN if not present
    if ! grep -q "_PLAN_SLUG_RE" agent/skill_commands.py; then
        sed -i '/_SKILL_MULTI_HYPHEN = re.compile/a\
\
# Plan path helpers (removed in upstream, kept for TUI /plan command compatibility)\
_PLAN_SLUG_RE = re.compile(r"[^a-z0-9-]")\
\
def build_plan_path(\
    user_instruction: str = "",\
    *,\
    now: datetime | None = None,\
) -> Path:\
    """Return the default workspace-relative markdown path for a /plan invocation."""\
    slug_source = (user_instruction or "").strip().splitlines()[0] if user_instruction else ""\
    slug = _PLAN_SLUG_RE.sub("-", slug_source.lower()).strip("-")\
    if slug:\
        slug = "-".join(part for part in slug.split("-")[:8] if part)[:48].strip("-")\
    slug = slug or "conversation-plan"\
    timestamp = (now or datetime.now()).strftime("%Y-%m-%d_%H%M%S")\
    return Path(".hermes") / "plans" / f"{timestamp}-{slug}.md"
' agent/skill_commands.py
    fi
fi

# Preserve custom_provider_slug function if it was lost
# (upstream removed it but our model_switch.py still needs it)
if ! grep -q "def custom_provider_slug" hermes_cli/providers.py 2>/dev/null; then
    echo "Restoring custom_provider_slug to hermes_cli/providers.py..."
    cat >> hermes_cli/providers.py << 'PYEOF'


def custom_provider_slug(display_name: str) -> str:
    """Build a canonical slug for a custom_providers entry.

    Matches the convention used by runtime_provider and credential_pool
    (``custom:<normalized-name>``).  Centralised here so all call-sites
    produce identical slugs.
    """
    return "custom:" + display_name.strip().lower().replace(" ", "-")
PYEOF
fi

# Push to origin
git add -A
git commit -m "upstream-sync: auto-rebase cleanup $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty
git push origin main --force-with-lease

echo "Sync complete. Fork is now on top of upstream/main."
