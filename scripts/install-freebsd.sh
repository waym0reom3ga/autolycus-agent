#!/bin/sh
# ============================================================================
# Autolycus Agent Installer - FreeBSD
# ============================================================================
# Strict POSIX sh — no bashisms, no zsh extensions.
# FreeBSD 14/15 uses /bin/sh (AT&T-derived) as the default login shell.
#
# Key differences from Linux/macOS:
#   - Packages install to /usr/local/bin (must be in PATH)
#   - Python at /usr/local/bin/python3.11
#   - Use 'pkg' for package management
#   - No systemd, no apt, no brew
# ============================================================================

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "$0" 2>/dev/null || echo .)" && pwd)"
. "$SCRIPT_DIR/install-common.sh"

# Ensure HOME is set (may be unset on some BSD systems in non-login shells)
if [ -z "${HOME:-}" ]; then
    HOME="$(getent passwd "$(whoami)" 2>/dev/null | cut -d: -f6)" || \
    HOME="$(eval echo ~$(whoami))" || \
    HOME="/root"
fi

# FreeBSD installs packages to /usr/local/bin, which sudo may strip from PATH.
case ":${PATH}:" in
    *:/usr/local/bin:*) ;; # already there
    *) PATH="/usr/local/bin:${PATH}" ;;
esac

# Ensure we use native FreeBSD tools — not GNU equivalents
export MAKE=${MAKE:-/usr/bin/make}  # BSD make, not gmake
export CC=${CC:-cc}                # system clang, not gcc

# Detect repo directory
_install_detect_dirs "$0"

PYTHON_VERSION="3.11"

echo ""
printf '%b\n' "${CYAN}${BOLD}⚕ Autolycus Agent Installer (FreeBSD)${NC}"
echo ""

# ============================================================================
# Prerequisites
# ============================================================================

check_prerequisites() {
    printf '%b\n' "${CYAN}→${NC} Checking prerequisites..."

    # Check for cargo/rust
    CARGO_CMD=""
    if type cargo > /dev/null 2>&1; then
        CARGO_CMD="cargo"
    elif [ -x "/usr/local/bin/cargo" ]; then
        CARGO_CMD="/usr/local/bin/cargo"
    elif [ -x "$HOME/.cargo/bin/cargo" ]; then
        CARGO_CMD="$HOME/.cargo/bin/cargo"
    fi

    if [ -z "$CARGO_CMD" ]; then
        printf '%b\n' "${RED}✗${NC} Rust/Cargo not found."
        echo ""
        echo "Install Rust:"
        echo "  pkg install rust"
        echo ""
        exit 1
    fi

    if ! CARGO_VERSION=$($CARGO_CMD --version 2>/dev/null | awk '{print $2}'); then
        printf '%b\n' "${RED}✗${NC} Found cargo at $CARGO_CMD but it failed to run."
        exit 1
    fi
    printf '%b\n' "${GREEN}✓${NC} Cargo $CARGO_VERSION found"

    # Check for curl (needed for uv installer)
    if ! type curl > /dev/null 2>&1; then
        printf '%b\n' "${RED}✗${NC} curl not found."
        echo "Install with: pkg install curl"
        exit 1
    fi
    printf '%b\n' "${GREEN}✓${NC} curl found"

    # Check for git (needed for repo operations)
    if ! type git > /dev/null 2>&1; then
        printf '%b\n' "${YELLOW}⚠${NC} git not found — some features may be limited."
        echo "Install with: pkg install git"
    else
        printf '%b\n' "${GREEN}✓${NC} git found"
    fi
}

check_prerequisites

# FreeBSD-specific hint (informational only — installer proceeds regardless)
echo ""
printf '%b\n' "${YELLOW}⚠ Tip:${NC} For better performance on FreeBSD, install native packages:"
echo "  pkg install py311-pillow py311-sqlite"
echo ""

# ============================================================================
# Install uv
# ============================================================================

install_uv() {
    printf '%b\n' "${CYAN}→${NC} Installing uv..."

    # Check if uv is already available
    if command -v uv > /dev/null 2>&1; then
        UV_CMD="uv"
        UV_VERSION=$($UV_CMD --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv already installed ($UV_VERSION)"
        return 0
    fi

    if [ -x "$HOME/.cargo/bin/uv" ]; then
        UV_CMD="$HOME/.cargo/bin/uv"
        UV_VERSION=$($UV_CMD --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv found at ~/.cargo/bin ($UV_VERSION)"
        return 0
    fi

    if [ -x "$HOME/.local/bin/uv" ]; then
        UV_CMD="$HOME/.local/bin/uv"
        UV_VERSION=$($UV_CMD --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv found at ~/.local/bin ($UV_VERSION)"
        return 0
    fi

    # Try pre-built binary installer first
    printf '%b\n' "${CYAN}→${NC} Installing uv via official installer..."
    if curl -LsSf https://astral.sh/uv/install.sh | sh; then
        if [ -x "$HOME/.local/bin/uv" ]; then
            UV_CMD="$HOME/.local/bin/uv"
        elif command -v uv > /dev/null 2>&1; then
            UV_CMD="uv"
        else
            printf '%b\n' "${RED}✗${NC} uv installed but not found on PATH"
            exit 1
        fi
        UV_VERSION=$($UV_CMD --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv installed ($UV_VERSION)"
        return 0
    fi

    # Fallback: install via cargo
    printf '%b\n' "${YELLOW}⚠${NC} Pre-built installer failed, falling back to cargo install..."
    if $CARGO_CMD install uv; then
        if [ -x "$HOME/.cargo/bin/uv" ]; then
            UV_CMD="$HOME/.cargo/bin/uv"
        elif command -v uv > /dev/null 2>&1; then
            UV_CMD="uv"
        else
            printf '%b\n' "${RED}✗${NC} uv installed but not found on PATH"
            exit 1
        fi
        UV_VERSION=$($UV_CMD --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv installed ($UV_VERSION)"
        return 0
    else
        printf '%b\n' "${RED}✗${NC} Failed to install uv."
        echo ""
        echo "Try installing manually: https://docs.astral.sh/uv/"
        exit 1
    fi
}

install_uv

# ============================================================================
# Python
# ============================================================================

setup_python() {
    printf '%b\n' "${CYAN}→${NC} Checking Python $PYTHON_VERSION..."

    # On FreeBSD, check system Python first (/usr/local/bin/python3.11)
    if [ -x "/usr/local/bin/python3.11" ]; then
        PYTHON_PATH="/usr/local/bin/python3.11"
        PYTHON_FOUND_VERSION=$($PYTHON_PATH --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} Python found: $PYTHON_FOUND_VERSION (system)"
    elif $UV_CMD python find "$PYTHON_VERSION" > /dev/null 2>&1; then
        PYTHON_PATH=$($UV_CMD python find "$PYTHON_VERSION")
        PYTHON_FOUND_VERSION=$($PYTHON_PATH --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} Python found: $PYTHON_FOUND_VERSION"
    else
        printf '%b\n' "${CYAN}→${NC} Python $PYTHON_VERSION not found."
        echo "Install with:"
        echo "  pkg install python311"
        echo ""

        # Try uv-managed Python as last resort
        printf '%b\n' "${CYAN}→${NC} Attempting to install via uv..."
        if $UV_CMD python install "$PYTHON_VERSION"; then
            PYTHON_PATH=$($UV_CMD python find "$PYTHON_VERSION")
            PYTHON_FOUND_VERSION=$($PYTHON_PATH --version 2>/dev/null)
            printf '%b\n' "${GREEN}✓${NC} Python installed: $PYTHON_FOUND_VERSION"
        else
            printf '%b\n' "${RED}✗${NC} Failed to install Python $PYTHON_VERSION"
            echo "Install manually with: pkg install python311"
            exit 1
        fi
    fi
}

setup_python

# ============================================================================
# Virtual environment
# ============================================================================

setup_venv() {
    printf '%b\n' "${CYAN}→${NC} Setting up virtual environment..."

    # Pre-flight: check for root-owned files that would block installation
    ROOT_OWNED=$(find "$_INSTALL_REPO_DIR" -maxdepth 1 ! -user "$(whoami)" -type f 2>/dev/null | head -5)
    if [ -n "$ROOT_OWNED" ]; then
        printf '%b\n' "${RED}✗${NC} Found files not owned by $(whoami) in $_INSTALL_REPO_DIR:"
        echo "$ROOT_OWNED" | sed 's/^/   /'
        echo ""
        echo "This usually means the repo was cloned or a previous install ran with sudo."
        echo "Fix ownership first:"
        echo "  chown -R $(whoami) $_INSTALL_REPO_DIR"
        exit 1
    fi

    # Check if we can write to the repo directory
    if [ ! -w "$_INSTALL_REPO_DIR" ]; then
        printf '%b\n' "${RED}✗${NC} Cannot write to repository directory: $_INSTALL_REPO_DIR"
        echo "You may need to fix permissions or run without sudo."
        echo ""
        echo "If a previous install used sudo, fix ownership:"
        echo "  chown -R $(whoami) $_INSTALL_REPO_DIR"
        exit 1
    fi

    # Remove old venv if it exists — but check ownership first
    if [ -d "$_INSTALL_REPO_DIR/venv" ]; then
        VENV_OWNER=$(stat -f '%Su' "$_INSTALL_REPO_DIR/venv" 2>/dev/null || echo "unknown")
        CURRENT_USER=$(whoami)

        if [ "$VENV_OWNER" != "$CURRENT_USER" ] && [ "$VENV_OWNER" != "unknown" ]; then
            printf '%b\n' "${RED}✗${NC} Existing venv owned by '$VENV_OWNER', not '$CURRENT_USER'"
            echo ""
            echo "This usually means a previous install ran with sudo."
            echo "Fix ownership:"
            echo "  chown -R $CURRENT_USER $_INSTALL_REPO_DIR/venv"
            echo ""
            echo "Or remove it manually and re-run this installer."
            exit 1
        fi

        printf '%b\n' "${CYAN}→${NC} Removing old venv..."
        rm -rf "$_INSTALL_REPO_DIR/venv"
    fi

    # Create the venv — use explicit absolute path to avoid any CWD confusion
    _VENV_PATH="$_INSTALL_REPO_DIR/venv"

    if [ -n "$PYTHON_PATH" ]; then
        $UV_CMD venv "$_VENV_PATH" --python "$PYTHON_PATH" 2>&1 || {
            printf '%b\n' "${RED}✗${NC} Failed to create virtual environment at: $_VENV_PATH"
            echo ""
            echo "Common causes on FreeBSD:"
            echo "  1. Previous install ran with sudo — root-owned files block creation"
            echo "     Fix: chown -R $(whoami) $_INSTALL_REPO_DIR"
            echo "  2. Insufficient disk space"
            echo "     Check: df -h $_INSTALL_REPO_DIR"
            echo "  3. Parent directory not writable"
            echo "     Check: ls -ld $_INSTALL_REPO_DIR"
            exit 1
        }
    else
        $UV_CMD venv "$_VENV_PATH" --python "$PYTHON_VERSION" 2>&1 || {
            printf '%b\n' "${RED}✗${NC} Failed to create virtual environment at: $_VENV_PATH"
            echo ""
            echo "Common causes on FreeBSD:"
            echo "  1. Previous install ran with sudo — root-owned files block creation"
            echo "     Fix: chown -R $(whoami) $_INSTALL_REPO_DIR"
            echo "  2. Insufficient disk space"
            echo "     Check: df -h $_INSTALL_REPO_DIR"
            echo "  3. Parent directory not writable"
            echo "     Check: ls -ld $_INSTALL_REPO_DIR"
            exit 1
        }
    fi

    printf '%b\n' "${GREEN}✓${NC} venv created (Python $PYTHON_VERSION)"
    export VIRTUAL_ENV="$_VENV_PATH"
}

setup_venv

# ============================================================================
# Dependencies
# ============================================================================

install_deps() {
    printf '%b\n' "${CYAN}→${NC} Installing dependencies..."

    # FreeBSD: exclude voice (faster-whisper), pty, and dev (ruff/jemalloc build fails on FreeBSD)
    EXTRAS="[modal,daytona,messaging,cron,cli,tts-premium,slack,honcho,mcp]"
    printf '%b\n' "${CYAN}→${NC} FreeBSD detected — installing selective extras (voice/pty/dev excluded)"

    # Prefer uv sync with lockfile
    if [ -f "$_INSTALL_REPO_DIR/uv.lock" ]; then
        printf '%b\n' "${CYAN}→${NC} Using uv.lock for hash-verified installation..."
        UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD sync --all-extras --locked 2>/dev/null && \
            printf '%b\n' "${GREEN}✓${NC} Dependencies installed (lockfile verified)" || {
            printf '%b\n' "${YELLOW}⚠${NC} Lockfile install failed, falling back to pip..."
            UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e ".${EXTRAS}"
            printf '%b\n' "${GREEN}✓${NC} Dependencies installed"
        }
    else
        UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e ".${EXTRAS}" || \
        UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e "."
        printf '%b\n' "${GREEN}✓${NC} Dependencies installed"
    fi
}

install_deps

# ============================================================================
# PATH setup & symlinks
# ============================================================================

setup_path() {
    printf '%b\n' "${CYAN}→${NC} Setting up hermes and lycus commands..."

    HERMES_BIN="$_INSTALL_REPO_DIR/venv/bin/hermes"
    LYCUS_BIN="$_INSTALL_REPO_DIR/venv/bin/lycus"

    mkdir -p "$HOME/.local/bin"

    # Use absolute symlinks to avoid broken links when running from different directories
    ln -sf "$HERMES_BIN" "$HOME/.local/bin/hermes"
    printf '%b\n' "${GREEN}✓${NC} Symlinked hermes → ~/.local/bin/hermes"

    ln -sf "$LYCUS_BIN" "$HOME/.local/bin/lycus"
    printf '%b\n' "${GREEN}✓${NC} Symlinked lycus → ~/.local/bin/lycus"

    # Detect login shell on FreeBSD using pw command
    LOGIN_SHELL="$(pw usershow "$(whoami)" -q 2>/dev/null | cut -d: -f7 | xargs basename)"
    [ -z "$LOGIN_SHELL" ] && LOGIN_SHELL="sh"

    _install_add_to_path "$LOGIN_SHELL"
}

setup_path

# ============================================================================
# Config & skills (from common library)
# ============================================================================

_install_setup_config
_install_sync_skills

# ============================================================================
# Done
# ============================================================================

echo ""
printf '%b\n' "${GREEN}${BOLD}✓ Installation complete!${NC}"
echo ""

# Shell-specific reload instructions
if [ -z "$LOGIN_SHELL" ]; then
    LOGIN_SHELL="$(pw usershow "$(whoami)" -q 2>/dev/null | cut -d: -f7 | xargs basename)"
    [ -z "$LOGIN_SHELL" ] && LOGIN_SHELL="sh"
fi

echo "Next steps:"
echo ""
echo "  1. Reload your shell:"
case "$LOGIN_SHELL" in
    csh|tcsh) echo "     source ~/.cshrc" ;;
    bash)     echo "     . ~/.bashrc" ;;
    zsh)      echo "     . ~/.zshrc" ;;
    *)        echo "     . ~/.profile   # sh" ;;
esac

echo ""
echo "  2. Configure API keys:"
echo "     hermes setup"
echo ""
echo "  3. Start chatting:"
echo "     hermes"
echo ""

# FreeBSD-specific notes
printf '%b\n' "${YELLOW}⚠ Note:${NC} For long-term memory support, install python-sqlite:"
echo "     pkg install py311-sqlite"
echo ""
printf '%b\n' "${YELLOW}⚠ Note:${NC} Voice transcription (faster-whisper) is unavailable on FreeBSD."
echo "     Use cloud STT instead: set GROQ_API_KEY or VOICE_TOOLS_OPENAI_KEY in ~/.hermes/.env"
echo ""
