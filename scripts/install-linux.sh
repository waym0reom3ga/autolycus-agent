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

PYTHON_VERSION="3.13"

# Detect CPU architecture for platform-specific exclusions
ARCH="$(uname -m)"

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
        ubuntu|debian|linuxmint|pop|armbian)
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

    # On Debian/Ubuntu (including Armbian), some Python packages need build tools.
    # Check and install them before anything else — cffi, cryptography, and others
    # build from source without these, wasting minutes before failing with
    # obscure compiler errors (e.g. "fatal error: ffi.h: No such file or directory").
    if [[ "$PKG_MANAGER" == "apt" ]]; then
        local need_build_tools=false
        # zlib1g-dev: required for Pillow (no armv7l wheels, must build from source)
        # libjpeg-dev: required for Pillow JPEG support (fails without it on armv7l)
        # libffi-dev: required for cffi/cryptography
        # python3-dev: required headers for C extensions
        for pkg in gcc python3-dev libffi-dev zlib1g-dev libjpeg-dev; do
            if ! dpkg -s "$pkg" &>/dev/null; then
                need_build_tools=true
                break
            fi
        done
        if [[ "$need_build_tools" == true ]]; then
            printf '%b\n' "${CYAN}→${NC} Installing build tools (gcc, python3-dev, libffi-dev, zlib1g-dev, libjpeg-dev)..."
            if command -v sudo &>/dev/null; then
                if sudo -n true 2>/dev/null; then
                    sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get update -qq && \
                    sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -qq build-essential python3-dev libffi-dev zlib1g-dev libjpeg-dev >/dev/null 2>&1 || true
                    printf '%b\n' "${GREEN}✓${NC} Build tools installed"
                else
                    printf '%b\n' "${YELLOW}⚠${NC} sudo is needed to install build tools (build-essential, python3-dev, libffi-dev)"
                    printf '%b\n' "${YELLOW}⚠${NC} Without these, Python packages like cffi/cryptography will fail to build."
                    printf '%b\n' "${YELLOW}⚠${NC} Install manually: sudo apt install build-essential python3-dev libffi-dev"
                fi
            fi
        fi
    elif [[ "$PKG_MANAGER" == "pacman" ]]; then
        # On Arch/Manjaro, check for base-devel (gcc, make) and libffi.
        # These are needed for cffi, cryptography, and other C-extension packages.
        local need_build_tools=false
        if ! pacman -Qe base-devel &>/dev/null || ! pacman -Qe libffi &>/dev/null || ! pacman -Qe python &>/dev/null; then
            need_build_tools=true
        fi
        if [[ "$need_build_tools" == true ]]; then
            printf '%b\n' "${CYAN}→${NC} Installing build tools (base-devel, libffi, python)..."
            if command -v sudo &>/dev/null; then
                if sudo -n true 2>/dev/null; then
                    sudo pacman -S --noconfirm --needed base-devel libffi python >/dev/null 2>&1 || true
                    printf '%b\n' "${GREEN}✓${NC} Build tools installed"
                else
                    printf '%b\n' "${YELLOW}⚠${NC} sudo is needed to install build tools (base-devel, libffi, python)"
                    printf '%b\n' "${YELLOW}⚠${NC} Without these, Python packages like cffi/cryptography will fail to build."
                    printf '%b\n' "${YELLOW}⚠${NC} Install manually: sudo pacman -S base-devel libffi python"
                fi
            fi
        fi
    fi

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
        uv_version=$($UV_CMD --version 2>/dev/null)
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
        uv_version=$($UV_CMD --version 2>/dev/null)
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
    printf '%b\n' "${CYAN}→${NC} Checking for system Python (>= 3.11, < 3.14)..."

    # First try to find any suitable system Python in the supported range.
    # This avoids installing a redundant Python when the system already has
    # a suitable version (e.g. 3.12 on Ubuntu 24.04, 3.13 on Debian 13).
    local found_system_python=false
    for candidate in python3.13 python3.12 python3.11 python3; do
        local candidate_path
        candidate_path=$(command -v "$candidate" 2>/dev/null || true)
        if [[ -n "$candidate_path" ]]; then
            # Check version is in supported range [3.11, 3.14)
            if "$candidate_path" -c 'import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 14) else 1)' 2>/dev/null; then
                PYTHON_PATH="$candidate_path"
                local py_version
                py_version=$("$PYTHON_PATH" --version 2>/dev/null)
                printf '%b\n' "${GREEN}✓${NC} System Python found: ${py_version}"
                found_system_python=true
                break
            fi
        fi
    done

    if [[ "$found_system_python" == false ]]; then
        printf '%b\n' "${CYAN}→${NC} No suitable system Python found, installing Python ${PYTHON_VERSION} via uv..."
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
                apt)      echo "  sudo apt install python3.13" ;;
                pacman)   echo "  sudo pacman -S python" ;;
                dnf)      echo "  sudo dnf install python3.13" ;;
                zypper)   echo "  sudo zypper install python313" ;;
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

    # Create the venv using the detected Python
    # uv venv --python expects a Python interpreter path or version specifier.
    # When we detected a system Python, PYTHON_PATH holds the actual binary path.
    # When we installed via uv, PYTHON_VERSION holds the version string.
    if [[ -n "$PYTHON_PATH" && -x "$PYTHON_PATH" ]]; then
        $UV_CMD venv "$_INSTALL_REPO_DIR/venv" --python "$PYTHON_PATH"
    else
        $UV_CMD venv "$_INSTALL_REPO_DIR/venv" --python "$PYTHON_VERSION"
    fi

    # Report the actual Python version in the venv (not the hardcoded default)
    local venv_py_version
    venv_py_version=$("$_INSTALL_REPO_DIR/venv/bin/python" --version 2>/dev/null)
    printf '%b\n' "${GREEN}✓${NC} venv created (${venv_py_version})"
    export VIRTUAL_ENV="$_INSTALL_REPO_DIR/venv"
}

setup_venv

# ============================================================================
# Dependencies
# ============================================================================

install_deps() {
    printf '%b\n' "${CYAN}→${NC} Installing dependencies..."

    # Build the extras list. Start with [all] but exclude extras that are
    # known to fail on this architecture.
    #
    # armv7l (32-bit ARM): PyTorch has no armv7l wheels, so chatterbox-tts
    # (which depends on torch) is unresolvable. Skip it to avoid a hard
    # install failure. The user can still use other TTS backends (Edge TTS,
    # ElevenLabs, Mistral) via lazy-install at first use.
    local _BROKEN_EXTRAS=()
    if [[ "$ARCH" == "armv7l" || "$ARCH" == "arm" || "$ARCH" == "aarch32" ]]; then
        _BROKEN_EXTRAS=("chatterbox")
        printf '%b\n' "${YELLOW}⚠${NC} Architecture ${ARCH} detected — excluding unsupported extras: ${_BROKEN_EXTRAS[*]}"
        printf '%b\n' "${YELLOW}⚠${NC} (chatterbox-tts requires PyTorch which has no armv7l wheels)"
    fi

    # Parse [all] contents from pyproject.toml so we can filter out broken extras.
    # Use the uv-managed Python (guaranteed 3.11+ with tomllib stdlib).
    local _ALL_EXTRAS_CSV=""
    if [[ "${#_BROKEN_EXTRAS[@]}" -gt 0 ]]; then
        _ALL_EXTRAS_CSV="$(
            "$PYTHON_PATH" -c "
import re, tomllib
with open('pyproject.toml', 'rb') as f:
    data = tomllib.load(f)
specs = data['project']['optional-dependencies']['all']
extras = []
for s in specs:
    m = re.search(r'lycus-agent\[([\w-]+)\]', s)
    if m:
        extras.append(m.group(1))
print(','.join(extras))
" 2>/dev/null || echo ""
        )"
    fi

    # Build the filtered extras spec
    local EXTRAS="[all]"
    if [[ -n "$_ALL_EXTRAS_CSV" && "${#_BROKEN_EXTRAS[@]}" -gt 0 ]]; then
        # Filter out broken extras
        local _SAFE_EXTRAS=()
        IFS=',' read -ra _ALL_EXTRAS_ARR <<< "$_ALL_EXTRAS_CSV"
        for _e in "${_ALL_EXTRAS_ARR[@]}"; do
            local _skip=false
            for _b in "${_BROKEN_EXTRAS[@]}"; do
                [[ "$_e" == "$_b" ]] && _skip=true && break
            done
            [[ "$_skip" == false ]] && _SAFE_EXTRAS+=("$_e")
        done
        EXTRAS="[$(IFS=','; echo "${_SAFE_EXTRAS[*]}")]"
        printf '%b\n' "${CYAN}→${NC} Installing curated stack (filtered for ${ARCH}): ${EXTRAS}"
    elif [[ "${#_BROKEN_EXTRAS[@]}" -gt 0 ]]; then
        # Parse failed — use hardcoded safe list (all [all] extras minus broken ones).
        # This matches the current pyproject.toml [all] minus chatterbox.
        EXTRAS="[cron,cli,pty,mcp,homeassistant,sms,acp,temporal,google,web,youtube]"
        printf '%b\n' "${YELLOW}⚠${NC} Could not parse pyproject.toml, using hardcoded safe extras for ${ARCH}"
        printf '%b\n' "${CYAN}→${NC} Installing: ${EXTRAS}"
    else
        printf '%b\n' "${CYAN}→${NC} Installing full stack (includes voice/pty)"
    fi

    # Tiered install: try lockfile first, then pip with filtered extras, then core only.
    # Skip lockfile sync when we have broken extras — the lockfile was generated for
    # x86_64 and includes packages (torch) that have no armv7l wheels, so it will
    # always fail on constrained architectures.
    if [[ -f "$_INSTALL_REPO_DIR/uv.lock" && "${#_BROKEN_EXTRAS[@]}" -eq 0 ]]; then
        printf '%b\n' "${CYAN}→${NC} Using uv.lock for hash-verified installation..."
        if UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD sync --all-extras --locked 2>/dev/null; then
            printf '%b\n' "${GREEN}✓${NC} Dependencies installed (lockfile verified)"
            return 0
        fi
        printf '%b\n' "${YELLOW}⚠${NC} Lockfile install failed, falling back to pip..."
    else
        printf '%b\n' "${CYAN}→${NC} Resolving from PyPI..."
    fi

    # Tier 1: install with filtered extras
    if UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e ".${EXTRAS}" 2>"/tmp/lycus-install-stderr.log"; then
        printf '%b\n' "${GREEN}✓${NC} Dependencies installed"
        return 0
    fi

    # Tier 2: core only — last resort so at least the CLI launches
    printf '%b\n' "${YELLOW}⚠${NC} Extras install failed, installing core only..."
    if UV_PROJECT_ENVIRONMENT="$_INSTALL_REPO_DIR/venv" $UV_CMD pip install -e "." 2>"/tmp/lycus-install-stderr.log"; then
        printf '%b\n' "${GREEN}✓${NC} Core dependencies installed (some features may be limited)"
        printf '%b\n' "${YELLOW}⚠${NC} To install missing extras later: cd $_INSTALL_REPO_DIR && uv pip install -e '.${EXTRAS}'"
        return 0
    fi

    printf '%b\n' "${RED}✗${NC} Failed to install even core dependencies."
    echo ""
    echo "Possible causes:"
    echo "  - Missing build tools: sudo apt install build-essential python3-dev libffi-dev"
    echo "  - Network issues"
    echo ""
    echo "Try: cd $_INSTALL_REPO_DIR && uv pip install -e '.'"
    exit 1
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
_install_setup_totalrecall
_install_setup_khronos

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
