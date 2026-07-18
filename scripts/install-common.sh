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
        _INSTALL_SCRIPT_DIR="${AUTOLYCUS_HOME:-$HOME/compiled}/autolycus-agent"
    fi

    _INSTALL_REPO_DIR="$(cd "$_INSTALL_SCRIPT_DIR/.." 2>/dev/null && pwd)" || _INSTALL_REPO_DIR="$_INSTALL_SCRIPT_DIR"

    if [ ! -f "$_INSTALL_REPO_DIR/pyproject.toml" ]; then
        _INSTALL_REPO_DIR="${AUTOLYCUS_HOME:-$HOME/compiled}/autolycus-agent"
    fi

    cd "$_INSTALL_REPO_DIR"
}

# ---------------------------------------------------------------------------
# Config file setup (platform-agnostic)
# ---------------------------------------------------------------------------
_install_setup_config() {
    printf '%b\n' "${CYAN}→${NC} Setting up configuration files..."

    AUTOLYCUS_HOME="${AUTOLYCUS_HOME:-$HOME/.autolycus}"
    mkdir -p "$AUTOLYCUS_HOME"/{cron,sessions,logs,memories,skills}

    # .env file
    if [ ! -f "$AUTOLYCUS_HOME/.env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example "$AUTOLYCUS_HOME/.env"
            printf '%b\n' "${GREEN}✓${NC} Created ~/.autolycus/.env from template"
        else
            touch "$AUTOLYCUS_HOME/.env"
            printf '%b\n' "${GREEN}✓${NC} Created ~/.autolycus/.env"
        fi
    else
        printf '%b\n' "${GREEN}✓${NC} ~/.autolycus/.env already exists"
    fi

    # config.yaml
    if [ ! -f "$AUTOLYCUS_HOME/config.yaml" ]; then
        if [ -f "cli-config.yaml.example" ]; then
            cp cli-config.yaml.example "$AUTOLYCUS_HOME/config.yaml"
            printf '%b\n' "${GREEN}✓${NC} Created ~/.autolycus/config.yaml from template"
        fi
    else
        printf '%b\n' "${GREEN}✓${NC} ~/.autolycus/config.yaml already exists"
    fi

    # Agent identity — interactive name choice on first install
    if [ ! -f "$AUTOLYCUS_HOME/.autolycus_agent_name" ]; then
        AGENT_NAMES="Atlas Bastion Cipher Drift Echo Flux Glint Haven Ion Jinx Kairo Lumen Nexus Orbit Prism Quill Rift Spark Talus Vex Warden Zephyr Axiom Blaze Coda Dusk Ember Frost Grail Haze Inferno Jade Kite Lance Mist Nova Onyx Pulse Quasar Rune Sage Titan Umber Volt Wrath Xenon Yucca Zenith Apex Bolt Crux Dune Eclipse Forge Gale Horizon Ignis Jolt Kinetic Lynx Magma Nimbus Opal Phoenix Quantum Radar Solar Terra Ultra Vector Wraith Raven Yield Zen Arc"
        NUM_NAMES=80

        echo ""
        printf '%b\n' "${CYAN}${BOLD}  ┌──────────────────────────────────────────────────────┐${NC}"
        printf '%b\n' "${CYAN}${BOLD}  │           Agent Identity Selection                   │${NC}"
        printf '%b\n' "${CYAN}${BOLD}  └──────────────────────────────────────────────────────┘${NC}"
        echo ""
        echo "  Your agent will choose a name from the list below."
        echo "  This becomes their identity — they'll introduce themselves"
        echo "  by this name every session."
        echo ""

        # Show names in columns for readability
        printf '%b\n' "${CYAN}  Available names:${NC}"
        i=1
        for name in $AGENT_NAMES; do
            printf '    %3d. %-12s' "$i" "$name"
            if [ $((i % 4)) -eq 0 ]; then
                echo ""
            fi
            i=$((i + 1))
        done
        [ $(( (i-1) % 4 )) -ne 0 ] && echo ""

        echo ""
        printf '%b\n' "${CYAN}  Choose a name:${NC}"
        echo "    Enter a number (1-$NUM_NAMES), type any name, or press Enter for random"
        echo ""

        read -r -e NAME_CHOICE
        if [ -z "$NAME_CHOICE" ]; then
            # Random selection
            if [ -n "${RANDOM:-}" ]; then
                IDX=$((RANDOM % NUM_NAMES))
            else
                IDX=$(od -An -tu4 -N4 /dev/urandom 2>/dev/null | tr -d ' ' || echo 0)
                IDX=$((IDX % NUM_NAMES))
            fi
            AGENT_NAME=$(echo "$AGENT_NAMES" | tr ' ' '\n' | sed -n "$((IDX + 1))p")
            [ -z "$AGENT_NAME" ] && AGENT_NAME="Terra"
            printf '%b\n' "${YELLOW}  → Random selection: ${AGENT_NAME}${NC}"
        elif echo "$NAME_CHOICE" | grep -qE '^[0-9]+$'; then
            # Number choice
            if [ "$NAME_CHOICE" -ge 1 ] && [ "$NAME_CHOICE" -le "$NUM_NAMES" ]; then
                AGENT_NAME=$(echo "$AGENT_NAMES" | tr ' ' '\n' | sed -n "${NAME_CHOICE}p")
            else
                printf '%b\n' "${YELLOW}  → Number out of range, picking random...${NC}"
                if [ -n "${RANDOM:-}" ]; then
                    IDX=$((RANDOM % NUM_NAMES))
                else
                    IDX=$(od -An -tu4 -N4 /dev/urandom 2>/dev/null | tr -d ' ' || echo 0)
                    IDX=$((IDX % NUM_NAMES))
                fi
                AGENT_NAME=$(echo "$AGENT_NAMES" | tr ' ' '\n' | sed -n "$((IDX + 1))p")
            fi
        else
            # Direct name entry — validate against list
            VALID=0
            for n in $AGENT_NAMES; do
                if [ "$(echo "$n" | tr '[:upper:]' '[:lower:]')" = "$(echo "$NAME_CHOICE" | tr '[:upper:]' '[:lower:]')" ]; then
                    AGENT_NAME="$n"
                    VALID=1
                    break
                fi
            done
            if [ "$VALID" -eq 0 ]; then
                printf '%b\n' "${YELLOW}  → '${NAME_CHOICE}' not in list, using as-is${NC}"
                AGENT_NAME="$NAME_CHOICE"
            fi
        fi

        echo "$AGENT_NAME" > "$AUTOLYCUS_HOME/.autolycus_agent_name"
        printf '%b\n' "${GREEN}${BOLD}  ✓ Agent identity assigned: ${AGENT_NAME}${NC}"
    else
        EXISTING_NAME=$(cat "$AUTOLYCUS_HOME/.autolycus_agent_name")
        printf '%b\n' "${GREEN}✓${NC} Agent identity: $EXISTING_NAME"
    fi

    # SOUL.md
    if [ ! -f "$AUTOLYCUS_HOME/SOUL.md" ]; then
        cat > "$AUTOLYCUS_HOME/SOUL.md" << 'SOUL_EOF'
# Autolycus Agent Persona

<!--
This file defines the agent's personality and tone.
The agent will embody whatever you write here.
Edit this to customize how Autolycus communicates with you.

This file is loaded fresh each message -- no restart needed.
Delete the contents (or this file) to use the default personality.
-->
SOUL_EOF
        printf '%b\n' "${GREEN}✓${NC} Created ~/.autolycus/SOUL.md"
    fi
}

# ---------------------------------------------------------------------------
# TotalRecall memory system setup (platform-agnostic, runs after venv is created)
# ---------------------------------------------------------------------------
_install_setup_totalrecall() {
    printf '%b\n' "${CYAN}→${NC} Setting up TotalRecall memory system..."

    AUTOLYCUS_HOME="${AUTOLYCUS_HOME:-$HOME/.autolycus}"
    TOTALRECALL_DIR="$AUTOLYCUS_HOME/TotalRecall"

    # Check if already installed
    if [ -d "$TOTALRECALL_DIR" ] && [ -f "$TOTALRECALL_DIR/pyproject.toml" ]; then
        printf '%b\n' "${GREEN}✓${NC} TotalRecall already installed at ~/.autolycus/TotalRecall"
        return 0
    fi

    # Clone from GitHub
    if command -v git &>/dev/null; then
        printf '%b\n' "${CYAN}→${NC} Cloning TotalRecall from GitHub..."
        mkdir -p "$AUTOLYCUS_HOME"
        if git clone --depth 1 https://github.com/waym0reom3ga/TotalRecall.git "$TOTALRECALL_DIR" 2>/dev/null; then
            printf '%b\n' "${GREEN}✓${NC} TotalRecall cloned successfully"
        else
            printf '%b\n' "${YELLOW}⚠${NC} Git clone failed, trying direct download..."
            _install_fallback_totalrecall "$TOTALRECALL_DIR"
            return $?
        fi
    else
        printf '%b\n' "${CYAN}→${NC} git not found, using curl fallback..."
        _install_fallback_totalrecall "$TOTALRECALL_DIR"
        return $?
    fi

    # Install TotalRecall into the venv
    if [ -d "$_INSTALL_REPO_DIR/venv" ]; then
        printf '%b\n' "${CYAN}→${NC} Installing TotalRecall into Autolycus venv..."
        UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e "$TOTALRECALL_DIR" 2>/dev/null || \
            $_INSTALL_REPO_DIR/venv/bin/pip install -e "$TOTALRECALL_DIR" 2>/dev/null || true
        printf '%b\n' "${GREEN}✓${NC} TotalRecall installed in venv"
    fi

    # Initialize TotalRecall database directory
    TOTALRECALL_DB="$AUTOLYCUS_HOME/.totalrecall"
    mkdir -p "$TOTALRECALL_DB"
    printf '%b\n' "${GREEN}✓${NC} TotalRecall data directory: ~/.autolycus/.totalrecall"

    # Create initial config if not present
    TOTALRECALL_CONFIG="$AUTOLYCUS_HOME/totalrecall.yaml"
    if [ ! -f "$TOTALRECALL_CONFIG" ]; then
        cat > "$TOTALRECALL_CONFIG" << 'TR_EOF'
# TotalRecall Configuration
# Recursive memory compression system for Autolycus Agent

db_dir: ~/.autolycus/.totalrecall

# Model settings (override via environment or CLI)
# model: gpt-4o-mini
# base_url: https://api.openai.com/v1

# Compression settings
compression:
  max_chunk_size: 50
  min_memories_for_compression: 3
  token_budget: 200000
TR_EOF
        printf '%b\n' "${GREEN}✓${NC} Created ~/.autolycus/totalrecall.yaml"
    fi

    echo ""
    printf '%b\n' "${CYAN}${BOLD}  ┌──────────────────────────────────────────────────────┐${NC}"
    printf '%b\n' "${CYAN}${BOLD}  │           TotalRecall Memory System                   │${NC}"
    printf '%b\n' "${CYAN}${BOLD}  └──────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo "  TotalRecall captures your agent interactions and compresses"
    echo "  them into high-signal memories through recursive LLM distillation."
    echo ""
    echo "  Usage:"
    echo "    totalrecall status              # Check memory status"
    echo "    totalrecall ingest --help       # Ingest commands"
    echo "    totalrecall chunk               # Assign chunks for compression"
    echo "    totalrecall compress --chunk N  # Compress a chunk to memories"
    echo "    totalrecall recall --tags TAG   # Recall by tags"
    echo ""
}

_install_fallback_totalrecall() {
    TARGET_DIR="$1"
    
    rm -rf "$TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    
    # Download as zip and extract
    if curl -fsSL "https://github.com/waym0reom3ga/TotalRecall/archive/refs/heads/main.zip" \
        -o "/tmp/totalrecall-main.zip" 2>/dev/null; then
        cd /tmp && unzip -q totalrecall-main.zip && \
            mv TotalRecall-main/* "$TARGET_DIR/" && \
            rm -rf TotalRecall-main /tmp/totalrecall-main.zip
        printf '%b\n' "${GREEN}✓${NC} TotalRecall downloaded via curl"
    else
        printf '%b\n' "${RED}✗${NC} Failed to download TotalRecall"
        echo "  Install manually:"
        echo "    git clone https://github.com/waym0reom3ga/TotalRecall.git ~/.autolycus/TotalRecall"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Khronos workflow server setup (platform-agnostic, runs after venv is created)
# ---------------------------------------------------------------------------
_install_setup_khronos() {
    printf '%b\n' "${CYAN}→${NC} Setting up Khronos workflow server..."

    AUTOLYCUS_HOME="${AUTOLYCUS_HOME:-$HOME/.autolycus}"
    SCRIPTS_DIR="$AUTOLYCUS_HOME/scripts"
    mkdir -p "$SCRIPTS_DIR" "$AUTOLYCUS_HOME/logs"

    # Copy the manager script
    if [ -f "$_INSTALL_SCRIPT_DIR/khronos_manager.py" ]; then
        cp "$_INSTALL_SCRIPT_DIR/khronos_manager.py" "$SCRIPTS_DIR/khronos_manager.py"
        chmod +x "$SCRIPTS_DIR/khronos_manager.py"
        printf '%b\n' "${GREEN}✓${NC} Khronos manager installed"
    else
        printf '%b\n' "${YELLOW}⚠${NC} Khronos manager script not found, skipping"
        return 1
    fi

    # Configure the hook if config.yaml exists and doesn't have hooks yet
    if [ -f "$AUTOLYCUS_HOME/config.yaml" ]; then
        # Check if hooks are already configured
        if ! grep -q "hooks:" "$AUTOLYCUS_HOME/config.yaml" 2>/dev/null; then
            # Add hooks section before the closing if it doesn't exist
            python3 -c "
import yaml
with open('$AUTOLYCUS_HOME/config.yaml', 'r') as f:
    config = yaml.safe_load(f)
config.setdefault('hooks', {})
config['hooks']['on_session_start'] = [
    {
        'command': 'python3 $SCRIPTS_DIR/khronos_manager.py start',
        'timeout': 15,
        'allowlist': True
    }
]
with open('$AUTOLYCUS_HOME/config.yaml', 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)
" 2>/dev/null
            printf '%b\n' "${GREEN}✓${NC} Khronos hook configured"
        else
            printf '%b\n' "${GREEN}✓${NC} Hooks already configured, skipping"
        fi
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
            cp -rn "skills/"* "$HOME/.autolycus/skills/" 2>/dev/null || true
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
