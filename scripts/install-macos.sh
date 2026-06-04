#!/usr/bin/env zsh
# ============================================================================
# Autolycus Agent Installer - macOS
# ============================================================================
# Zsh — uses native globbing, arrays, zstyle, named directories.
# macOS Catalina+ uses zsh as the default login shell.
#
# Key features:
#   - Homebrew detection and installation
#   - Apple Silicon (arm64) vs Intel (x86_64) handling
#   - Full extras including voice tools
# ============================================================================

set -euo pipefail

# Source common library (POSIX sh compatible — safe to source from zsh)
SCRIPT_DIR="$(cd "$(dirname "${(%):-%x}")" && pwd)"
source "$SCRIPT_DIR/install-common.sh"

# Detect repo directory
_install_detect_dirs "${(%):-%x}"

PYTHON_VERSION="3.11"

echo ""
printf '%b\n' "${CYAN}${BOLD}⚕ Autolycus Agent Installer (macOS)${NC}"
echo ""

# ============================================================================
# Architecture detection
# ============================================================================

detect_arch() {
    ARCH="$(uname -m)"
    case "$ARCH" in
        arm64)
            echo -e "${GREEN}✓${NC} Detected: Apple Silicon (${ARCH})"
            ;;
        x86_64)
            # Check if running under Rosetta
            sysctl -n machdep.cpu.brand_string &>/dev/null | grep -q "Intel" && \
                echo -e "${GREEN}✓${NC} Detected: Intel Mac (${ARCH})" || \
                echo -e "${YELLOW}⚠${NC} Running on ${ARCH} — may be under Rosetta 2 translation"
            ;;
        *)
            echo -e "${YELLOW}⚠${NC} Unknown architecture: ${ARCH}"
            ;;
    esac
}

detect_arch

# ============================================================================
# Prerequisites
# ============================================================================

check_prerequisites() {
    printf '%b\n' "${CYAN}→${NC} Checking prerequisites..."

    # Check for Homebrew — the de facto package manager on macOS
    if ! command -v brew &>/dev/null; then
        echo ""
        echo "Homebrew not found. This is required for most dependencies."
        echo ""
        printf '%b\n' "${CYAN}→${NC} Install Homebrew? (y/n) "
        read -r install_brew
        if [[ "$install_brew" == [yY] || "$install_brew" == [yY][eE][sS] ]]; then
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

            # Add Homebrew to PATH for the current session
            if [[ "$ARCH" == "arm64" ]]; then
                eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
            else
                eval "$(brew shellenv)" 2>/dev/null || true
            fi
        else
            echo ""
            echo "Skipping Homebrew installation. You'll need to install dependencies manually."
            echo "See: https://brew.sh/"
            exit 1
        fi
    fi
    printf '%b\n' "${GREEN}✓${NC} Homebrew found"

    # Check for cargo/rust
    if ! command -v cargo &>/dev/null; then
        echo ""
        echo "Rust/Cargo not found."
        printf '%b\n' "${CYAN}→${NC} Installing via Homebrew... "
        brew install rustup
        rustup init -y
        source "$HOME/.cargo/env" 2>/dev/null || true
    fi

    local cargo_version
    if command -v cargo &>/dev/null; then
        cargo_version=$(cargo --version 2>/dev/null | awk '{print $2}')
        printf '%b\n' "${GREEN}✓${NC} Cargo ${cargo_version} found"
    else
        echo ""
        echo "Rust installation failed. Install manually:"
        echo "  brew install rustup && rustup init"
        exit 1
    fi

    # Check for make (Xcode Command Line Tools)
    if ! command -v make &>/dev/null; then
        echo ""
        printf '%b\n' "${YELLOW}⚠${NC} make not found — installing Xcode Command Line Tools... "
        xcode-select --install &>/dev/null || true
        # User needs to accept the license dialog — we can't automate that
        if ! command -v make &>/dev/null; then
            echo ""
            echo "Please complete the Xcode Command Line Tools installation"
            echo "(accept the license prompt), then re-run this installer."
            exit 1
        fi
    fi
    printf '%b\n' "${GREEN}✓${NC} make found"

    # Check for curl (usually pre-installed on macOS)
    if command -v curl &>/dev/null; then
        printf '%b\n' "${GREEN}✓${NC} curl found"
    else
        echo "curl not found — installing via Homebrew..."
        brew install curl
    fi

    # Check for git (usually pre-installed)
    if command -v git &>/dev/null; then
        printf '%b\n' "${GREEN}✓${NC} git found"
    else
        printf '%b\n' "${YELLOW}⚠${NC} git not found — installing via Homebrew..."
        brew install git
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

    # Check common locations
    local -a uv_paths=("$HOME/.cargo/bin/uv" "$HOME/.local/bin/uv")
    if [[ "$ARCH" == "arm64" ]]; then
        uv_paths+=("/opt/homebrew/bin/uv")
    else
        uv_paths+=("/usr/local/bin/uv")
    fi

    for uv_path in "${uv_paths[@]}"; do
        if [[ -x "$uv_path" ]]; then
            UV_CMD="$uv_path"
            local uv_version
            uv_version=$(uv --version 2>/dev/null)
            printf '%b\n' "${GREEN}✓${NC} uv found at ${~uv_path} (${uv_version})"
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

    # Fallback: install via Homebrew
    printf '%b\n' "${YELLOW}⚠${NC} Pre-built installer failed, trying Homebrew..."
    if brew install uv; then
        if [[ "$ARCH" == "arm64" ]]; then
            UV_CMD="/opt/homebrew/bin/uv"
        else
            UV_CMD="/usr/local/bin/uv"
        fi
        local uv_version
        uv_version=$(uv --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv installed via Homebrew (${uv_version})"
        return 0
    fi

    # Last resort: cargo install
    printf '%b\n' "${YELLOW}⚠${NC} Homebrew failed, falling back to cargo install..."
    if cargo install uv; then
        UV_CMD="$HOME/.cargo/bin/uv"
        local uv_version
        uv_version=$(uv --version 2>/dev/null)
        printf '%b\n' "${GREEN}✓${NC} uv installed via cargo (${uv_version})"
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
            echo "  brew install python@3.11"
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
        venv_owner=$(stat -f '%Su' "$_INSTALL_REPO_DIR/venv" 2>/dev/null || echo "unknown")

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

    # macOS gets the full stack including voice tools
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
    printf '%b\n' "${CYAN}→${NC} Setting up hermes and lycus commands..."

    local hermes_bin="$_INSTALL_REPO_DIR/venv/bin/hermes"
    local lycus_bin="$_INSTALL_REPO_DIR/venv/bin/lycus"

    mkdir -p "$HOME/.local/bin"

    ln -sf "$hermes_bin" "$HOME/.local/bin/hermes"
    printf '%b\n' "${GREEN}✓${NC} Symlinked hermes → ~/.local/bin/hermes"

    ln -sf "$lycus_bin" "$HOME/.local/bin/lycus"
    printf '%b\n' "${GREEN}✓${NC} Symlinked lycus → ~/.local/bin/lycus"

    # macOS uses zsh by default — add to .zshrc
    _install_add_to_path "zsh"
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

echo "Next steps:"
echo ""
echo "  1. Reload your shell:"
echo "     source ~/.zshrc"
echo ""
echo "  2. Configure API keys:"
echo "     hermes setup"
echo ""
echo "  3. Start chatting:"
echo "     hermes"
echo ""
echo "Other commands:"
echo "  hermes status        # Check configuration"
echo "  hermes doctor        # Diagnose issues"
echo "  hermes gateway install # Install gateway service"
echo ""

# macOS-specific notes
if [[ "$ARCH" == "x86_64" ]]; then
    sysctl -n machdep.cpu.brand_string &>/dev/null | grep -q "Intel" || {
        printf '%b\n' "${YELLOW}⚠ Note:${NC} You appear to be running under Rosetta 2."
        echo "     For native Apple Silicon performance, use an arm64 terminal."
        echo ""
    }
fi
