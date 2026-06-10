#!/bin/sh
# ============================================================================
# Autolycus Agent Installer - Common Library
# ============================================================================
# Shared functions sourced by all platform scripts.
# MUST be POSIX sh compatible — no bashisms, no zsh extensions.
# ============================================================================

# ---------------------------------------------------------------------------
# Colors (ANSI escape sequences)
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Script/Repo directory detection (works when piped via curl | sh)
# ---------------------------------------------------------------------------
_install_detect_dirs() {
    _INSTALL_SCRIPT_DIR="$(cd "$(dirname "${1:-$0}" 2>/dev/null || echo .)" 2>/dev/null && pwd)" || _INSTALL_SCRIPT_DIR="."

    if [ ! -f "$_INSTALL_SCRIPT_DIR/../pyproject.toml" ] && [ ! -f "$_INSTALL_SCRIPT_DIR/pyproject.toml" ]; then
        _INSTALL_SCRIPT_DIR="${LYCUS_HOME:-$HOME/compiled}/autolycus-agent"
    fi

    _INSTALL_REPO_DIR="$(cd "$_INSTALL_SCRIPT_DIR/.." 2>/dev/null && pwd)" || _INSTALL_REPO_DIR="$_INSTALL_SCRIPT_DIR"

    if [ ! -f "$_INSTALL_REPO_DIR/pyproject.toml" ]; then
        _INSTALL_REPO_DIR="${LYCUS_HOME:-$HOME/compiled}/autolycus-agent"
    fi

    cd "$_INSTALL_REPO_DIR"
}

# ---------------------------------------------------------------------------
# Config file setup (platform-agnostic)
# ---------------------------------------------------------------------------
_install_setup_config() {
    printf '%b\n' "${CYAN}→${NC} Setting up configuration files..."

    HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
    mkdir -p "$HERMES_HOME"/{cron,sessions,logs,memories,skills}

    # .env file
    if [ ! -f "$HERMES_HOME/.env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example "$HERMES_HOME/.env"
            printf '%b\n' "${GREEN}✓${NC} Created ~/.hermes/.env from template"
        else
            touch "$HERMES_HOME/.env"
            printf '%b\n' "${GREEN}✓${NC} Created ~/.hermes/.env"
        fi
    else
        printf '%b\n' "${GREEN}✓${NC} ~/.hermes/.env already exists"
    fi

    # config.yaml
    if [ ! -f "$HERMES_HOME/config.yaml" ]; then
        if [ -f "cli-config.yaml.example" ]; then
            cp cli-config.yaml.example "$HERMES_HOME/config.yaml"
            printf '%b\n' "${GREEN}✓${NC} Created ~/.hermes/config.yaml from template"
        fi
    else
        printf '%b\n' "${GREEN}✓${NC} ~/.hermes/config.yaml already exists"
    fi

    # Agent identity — assign a random name on first install
    if [ ! -f "$HERMES_HOME/.hermes_agent_name" ]; then
        AGENT_NAMES="Atlas Bastion Cipher Drift Echo Flux Glint Haven Ion Jinx Kairo Lumen Nexus Orbit Prism Quill Rift Spark Talus Vex Warden Zephyr Axiom Blaze Coda Dusk Ember Frost Grail Haze Inferno Jade Kite Lance Mist Nova Onyx Pulse Quasar Rune Sage Titan Umber Volt Wrath Xenon Yucca Zenith Apex Bolt Crux Dune Eclipse Forge Gale Horizon Ignis Jolt Kinetic Lynx Magma Nimbus Opal Phoenix Quantum Radar Solar Terra Ultra Vector Wraith Yield Zen Arc"
        if [ -n "${RANDOM:-}" ]; then
            IDX=$((RANDOM % 78))
        else
            IDX=$(od -An -tu4 -N4 /dev/urandom 2>/dev/null | tr -d ' ' || echo 0)
            IDX=$((IDX % 78))
        fi
        AGENT_NAME=$(echo "$AGENT_NAMES" | tr ' ' '\n' | sed -n "$((IDX + 1))p")
        [ -z "$AGENT_NAME" ] && AGENT_NAME="Terra"
        echo "$AGENT_NAME" > "$HERMES_HOME/.hermes_agent_name"
        printf '%b\n' "${GREEN}✓${NC} Agent identity assigned: $AGENT_NAME"
    else
        EXISTING_NAME=$(cat "$HERMES_HOME/.hermes_agent_name")
        printf '%b\n' "${GREEN}✓${NC} Agent identity: $EXISTING_NAME"
    fi

    # SOUL.md
    if [ ! -f "$HERMES_HOME/SOUL.md" ]; then
        cat > "$HERMES_HOME/SOUL.md" << 'SOUL_EOF'
# Autolycus Agent Persona

<!--
This file defines the agent's personality and tone.
The agent will embody whatever you write here.
Edit this to customize how Autolycus communicates with you.

This file is loaded fresh each message -- no restart needed.
Delete the contents (or this file) to use the default personality.
-->
SOUL_EOF
        printf '%b\n' "${GREEN}✓${NC} Created ~/.hermes/SOUL.md"
    fi
}

# ---------------------------------------------------------------------------
# Skills sync (platform-agnostic, runs after venv is created)
# ---------------------------------------------------------------------------
_install_sync_skills() {
    printf '%b\n' "${CYAN}→${NC} Syncing bundled skills..."

    if "$_INSTALL_REPO_DIR/venv/bin/python" "$_INSTALL_REPO_DIR/tools/skills_sync.py" 2>/dev/null; then
        printf '%b\n' "${GREEN}✓${NC} Skills synced"
    else
        if [ -d "skills" ]; then
            cp -rn "skills/"* "$HOME/.hermes/skills/" 2>/dev/null || true
            printf '%b\n' "${GREEN}✓${NC} Skills copied (fallback)"
        fi
    fi
}

# ---------------------------------------------------------------------------
# Shell config PATH addition (POSIX-compatible detection)
# Each platform script calls this with its detected shell type.
# $1 = shell type: sh | bash | zsh | csh | tcsh
# ---------------------------------------------------------------------------
_install_add_to_path() {
    _SHELL_TYPE="${1:-sh}"

    if echo "$PATH" | tr ':' '\n' | grep -q "^$HOME/.local/bin$"; then
        printf '%b\n' "${GREEN}✓${NC} ~/.local/bin already on PATH"
        return 0
    fi

    _SHELL_CONFIG=""
    case "$_SHELL_TYPE" in
        csh|tcsh)  _SHELL_CONFIG="$HOME/.cshrc" ;;
        bash)      _SHELL_CONFIG="$HOME/.bashrc"; [ ! -f "$_SHELL_CONFIG" ] && _SHELL_CONFIG="$HOME/.bash_profile" ;;
        zsh)       _SHELL_CONFIG="$HOME/.zshrc" ;;
        *)         # fallback: check what exists
                   if [ -f "$HOME/.zshrc" ]; then
                       _SHELL_CONFIG="$HOME/.zshrc"
                   elif [ -f "$HOME/.bashrc" ]; then
                       _SHELL_CONFIG="$HOME/.bashrc"
                   elif [ -f "$HOME/.bash_profile" ]; then
                       _SHELL_CONFIG="$HOME/.bash_profile"
                   else
                       _SHELL_CONFIG="$HOME/.profile"
                   fi
                   ;;
    esac

    if [ -n "$_SHELL_CONFIG" ]; then
        touch "$_SHELL_CONFIG" 2>/dev/null || true
        if ! grep -q '\.local/bin' "$_SHELL_CONFIG" 2>/dev/null; then
            echo "" >> "$_SHELL_CONFIG"
            echo "# Autolycus Agent — ensure ~/.local/bin is on PATH" >> "$_SHELL_CONFIG"
            case "$_SHELL_TYPE" in
                csh|tcsh)
                    echo 'setenv PATH "$HOME/.local/bin:$PATH"' >> "$_SHELL_CONFIG"
                    ;;
                *)
                    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$_SHELL_CONFIG"
                    ;;
            esac
            printf '%b\n' "${GREEN}✓${NC} Added ~/.local/bin to PATH in $_SHELL_CONFIG"
        else
            printf '%b\n' "${GREEN}✓${NC} ~/.local/bin already in $_SHELL_CONFIG"
        fi
    fi
}
