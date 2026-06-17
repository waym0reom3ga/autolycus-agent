#!/usr/bin/env bash
# ============================================================================
# Autolycus Agent Installer - Linux
# ============================================================================
# Bash — uses arrays, [[ ]], process substitution, mapfile.
# Works on Debian/Ubuntu, Arch, Fedora, RHEL, and other major distros.
#
# Key features:
#   - Auto-detects package manager (apt, pacman, dnf, zypper)
#   - Handles systemd user quotas on /tmp (Arch)
#   - Full extras installation including voice tools
# ============================================================================

set -euo pipefail

# Source common library (POSIX sh compatible — safe to source from bash)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/install-common.sh"

# Detect repo directory
_install_detect_dirs "${BASH_SOURCE[0]}"

PYTHON_VERSION="3.11"

echo ""
printf '%b\n' "${CYAN}${BOLD}⚕ Autolycus Agent Installer (Linux)${NC}"
echo ""

# ============================================================================
# Distribution detection
# ============================================================================

detect_distro() {
    DISTRO="unknown"
    PKG_MANAGER=""

    if [[ -f /etc/os-release ]]; then
        # shellcheck source=/dev/null
        source /etc/os-release
        DISTRO="${ID:-unknown}"
        DISTRO_VERSION="${VERSION_ID:-unknown}"
    fi

    case "$DISTRO" in
        ubuntu|debian|linuxmint|pop)
            PKG_MANAGER="apt"
            ;;
        arch|manjaro|endeavouros)
            PKG_MANAGER="pacman"
            ;;
        fedora|rhel|centos|rocky|almalinux)
            PKG_MANAGER="dnf"
            ;;
        opensuse*|sles*)
            PKG_MANAGER="zypper"
            ;;
    esac

    echo -e "${GREEN}✓${NC} Detected: ${DISTRO} ${DISTRO_VERSION} (package manager: ${PKG_MANAGER:-unknown})"
}

detect_distro

# ============================================================================
# Prerequisites
# ============================================================================

check_prerequisites() {
    printf '%b\n' "${CYAN}→${NC} Checking prerequisites..."

    # Check for cargo/rust
    if ! command -v cargo &>/dev/null; then
        echo ""
        echo "Rust/Cargo not found. Install with:"
        case "$PKG_MANAGER" in
            apt)      echo "  sudo apt install cargo" ;;
            pacman)   echo "  sudo pacman -S rust" ;;
            dnf)      echo "  sudo dnf install cargo" ;;
            zypper)   echo "  sudo zypper install cargo" ;;
            *)        echo "  See https://www.rust-lang.org/tools/install" ;;
        esac
        echo ""
        exit 1
    fi

    local cargo_version
    cargo_version=$(cargo --version 2>/dev/null | awk '{print $2}')
    printf '%b\n' "${GREEN}✓${NC} Cargo ${cargo_version} found"

    # Check for make (needed for some builds)
    if ! command -v make &>/dev/null; then
        echo ""
        echo "make not found. Install with:"
        case "$PKG_MANAGER" in
            apt)      echo "  sudo apt install make" ;;
            pacman)   echo "  sudo pacman -S make" ;;
            dnf)      echo "  sudo dnf install make" ;;
            zypper)   echo "  sudo zypper install make" ;;
        esac
        exit 1
    fi
    printf '%b\n' "${GREEN}✓${NC} make found"

    # Check for curl
    if ! command -v curl &>/dev/null; then
        echo ""
        echo "curl not found. Install with:"
        case "$PKG_MANAGER" in
            apt)      echo "  sudo apt install curl" ;;
            pacman)   echo "  sudo pacman -S curl" ;;
            dnf)      echo "  sudo dnf install curl" ;;
            zypper)   echo "  sudo zypper install curl" ;;
        esac
        exit 1
    fi
    printf '%b\n' "${GREEN}✓${NC} curl found"

    # Check for git (recommended)
    if command -v git &>/dev/null; then
        printf '%b\n' "${GREEN}✓${NC} git found"
    else
        printf '%b\n' "${YELLOW}⚠${NC} git not found — some features may be limited."
    fi
}

check_prerequisites

# ============================================================================
# Install uv
# ============================================================================

install_uv() {
    printf '%b\n' "${CYAN}→${NC} Installing uv..."

    # Check if uv is already available
    if command -v uv &>/dev/null; then
        UV_CMD="uv"
        local uv_version
        uv_version=$(uv --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv already installed (${uv_version})"
        return 0
    fi

    for uv_path in "$HOME/.cargo/bin/uv" "$HOME/.local/bin/uv"; do
        if [[ -x "$uv_path" ]]; then
            UV_CMD="$uv_path"
            local uv_version
            uv_version=$(uv --version 2>/dev/null)
            printf '%b\n' "${GREEN}✓${NC} uv found at ${uv_path/\$HOME/~} (${uv_version})"
            return 0
        fi
    done

    # Try pre-built binary installer first (much faster than cargo build)
    printf '%b\n' "${CYAN}→${NC} Installing uv via official installer..."
    if curl -LsSf https://astral.sh/uv/install.sh | sh; then
        if [[ -x "$HOME/.local/bin/uv" ]]; then
            UV_CMD="$HOME/.local/bin/uv"
        elif command -v uv &>/dev/null; then
            UV_CMD="uv"
        else
            printf '%b\n' "${RED}✗${NC} uv installed but not found on PATH"
            exit 1
        fi
        local uv_version
        uv_version=$(uv --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv installed (${uv_version})"
        return 0
    fi

    # Fallback: install via cargo
    printf '%b\n' "${YELLOW}⚠${NC} Pre-built installer failed, falling back to cargo install..."

    # Arch Linux enforces systemd user quotas on /tmp even when df shows free space.
    if [[ -f /etc/arch-release ]]; then
        export TMPDIR="$HOME/.cargo/cargo-tmp"
        mkdir -p "$TMPDIR"
        printf '%b\n' "${CYAN}→${NC} Arch detected — using \$HOME for cargo staging (systemd tmpfs quota workaround)"
    fi

    if cargo install uv; then
        if [[ -x "$HOME/.cargo/bin/uv" ]]; then
            UV_CMD="$HOME/.cargo/bin/uv"
        elif command -v uv &>/dev/null; then
            UV_CMD="uv"
        else
            printf '%b\n' "${RED}✗${NC} uv installed but not found on PATH"
            echo "Try adding ~/.cargo/bin to PATH and re-running"
            exit 1
        fi
        local uv_version
        uv_version=$(uv --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv installed (${uv_version})"
    else
        printf '%b\n' "${RED}✗${NC} Failed to install uv."
        echo ""
        echo "Possible causes:"
        echo "  - Rust/Cargo not installed"
        echo "  - Disk space / tmpfs quota exceeded"
        echo "  - Network issues"
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
    printf '%b\n' "${CYAN}→${NC} Checking Python ${PYTHON_VERSION}..."

    if UV_PYTHON=$($UV_CMD python find "$PYTHON_VERSION" 2>/dev/null); then
        PYTHON_PATH="$UV_PYTHON"
        local py_version
        py_version=$("$PYTHON_PATH" --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} Python found: ${py_version}"
    else
        printf '%b\n' "${CYAN}→${NC} Python ${PYTHON_VERSION} not found, installing via uv..."
        if $UV_CMD python install "$PYTHON_VERSION"; then
            PYTHON_PATH=$($UV_CMD python find "$PYTHON_VERSION")
            local py_version
            py_version=$("$PYTHON_PATH" --version 2>/dev/null)
            printf '%b\n' "${GREEN}✓${NC} Python installed: ${py_version}"
        else
            printf '%b\n' "${RED}✗${NC} Failed to install Python ${PYTHON_VERSION}"
            echo ""
            echo "Install manually:"
            case "$PKG_MANAGER" in
                apt)      echo "  sudo apt install python3.11" ;;
                pacman)   echo "  sudo pacman -S python" ;;
                dnf)      echo "  sudo dnf install python3.11" ;;
                zypper)   echo "  sudo zypper install python311" ;;
            esac
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

    # Check write permission on repo directory
    if [[ ! -w "$_INSTALL_REPO_DIR" ]]; then
        printf '%b\n' "${RED}✗${NC} Cannot write to repository directory: $_INSTALL_REPO_DIR"
        echo "You may need to fix permissions or run without sudo."
        exit 1
    fi

    # Remove old venv if it exists — check ownership first
    if [[ -d "$_INSTALL_REPO_DIR/venv" ]]; then
        local venv_owner
        venv_owner=$(stat -c '%U' "$_INSTALL_REPO_DIR/venv" 2>/dev/null || echo "unknown")

        if [[ "$venv_owner" != "$(whoami)" && "$venv_owner" != "unknown" ]]; then
            printf '%b\n' "${RED}✗${NC} Existing venv owned by '${venv_owner}', not '$(whoami)'"
            echo ""
            echo "This usually means a previous install ran with sudo."
            echo "Fix ownership:"
            echo "  sudo chown -R $(whoami) $_INSTALL_REPO_DIR/venv"
            exit 1
        fi

        printf '%b\n' "${CYAN}→${NC} Removing old venv..."
        rm -rf "$_INSTALL_REPO_DIR/venv"
    fi

    # Create the venv
    $UV_CMD venv "$_INSTALL_REPO_DIR/venv" --python "$PYTHON_PATH" 2>/dev/null || \
    $UV_CMD venv "$_INSTALL_REPO_DIR/venv" --python "$PYTHON_VERSION"

    printf '%b\n' "${GREEN}✓${NC} venv created (Python ${PYTHON_VERSION})"
    export VIRTUAL_ENV="$_INSTALL_REPO_DIR/venv"
}

setup_venv

# ============================================================================
# Dependencies
# ============================================================================

install_deps() {
    printf '%b\n' "${CYAN}→${NC} Installing dependencies..."

    # Linux gets the full stack including voice tools
    EXTRAS="[all]"
    printf '%b\n' "${CYAN}→${NC} Installing full stack (includes voice/pty)"

    # Prefer uv sync with lockfile
    if [[ -f "$_INSTALL_REPO_DIR/uv.lock" ]]; then
        printf '%b\n' "${CYAN}→${NC} Using uv.lock for hash-verified installation..."
        if UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD sync --all-extras --locked 2>/dev/null; then
            printf '%b\n' "${GREEN}✓${NC} Dependencies installed (lockfile verified)"
        else
            printf '%b\n' "${YELLOW}⚠${NC} Lockfile install failed, falling back to pip..."
            UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e ".${EXTRAS}" || \
            UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e "."
            printf '%b\n' "${GREEN}✓${NC} Dependencies installed"
        fi
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
    printf '%b\n' "${CYAN}→${NC} Setting up lycus and lycus commands..."

    local lycus_bin="$_INSTALL_REPO_DIR/venv/bin/lycus"
    local lycus_bin="$_INSTALL_REPO_DIR/venv/bin/lycus"

    mkdir -p "$HOME/.local/bin"

    ln -sf "$lycus_bin" "$HOME/.local/bin/lycus"
    printf '%b\n' "${GREEN}✓${NC} Symlinked lycus → ~/.local/bin/lycus"

    ln -sf "$lycus_bin" "$HOME/.local/bin/lycus"
    printf '%b\n' "${GREEN}✓${NC} Symlinked lycus → ~/.local/bin/lycus"

    # Detect shell from $SHELL or /etc/passwd
    local login_shell
    login_shell=$(basename "${SHELL:-/bin/bash}")

    _install_add_to_path "$login_shell"
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

local_shell=$(basename "${SHELL:-/bin/bash}")

echo "Next steps:"
echo ""
echo "  1. Reload your shell:"
case "$local_shell" in
    zsh)      echo "     source ~/.zshrc" ;;
    bash)     echo "     source ~/.bashrc" ;;
    *)        echo "     source ~/.bashrc   # or ~/.zshrc" ;;
esac

echo ""
echo "  2. Configure API keys:"
echo "     lycus setup"
echo ""
echo "  3. Start chatting:"
echo "     lycus"
echo ""
echo "Other commands:"
echo "  lycus status        # Check configuration"
echo "  lycus doctor        # Diagnose issues"
echo "  lycus gateway install # Install gateway service"
echo ""
