#!/bin/sh
# ============================================================================
# Autolycus Agent Installer - Main Dispatcher
# ============================================================================
# Detects the operating system and delegates to the appropriate platform script.
# POSIX-compliant — works with /bin/sh on any Unix-like system.
#
# Usage:
#   sh scripts/install-autolycus.sh
#   curl -fsSL https://... | sh
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0" 2>/dev/null || echo .)" 2>/dev/null && pwd)" || SCRIPT_DIR="."

detect_and_dispatch() {
    OS_NAME="$(uname -s)"

    case "$OS_NAME" in
        FreeBSD*)
            PLATFORM="freebsd"
            ;;
        Linux*)
            PLATFORM="linux"
            ;;
        Darwin*)
            PLATFORM="macos"
            ;;
        *)
            echo "Error: Unsupported operating system: $OS_NAME"
            echo "Supported platforms: FreeBSD, Linux, macOS"
            exit 1
            ;;
    esac

    PLATFORM_SCRIPT="$SCRIPT_DIR/install-${PLATFORM}.sh"

    if [ ! -f "$PLATFORM_SCRIPT" ]; then
        echo "Error: Platform script not found: $PLATFORM_SCRIPT"
        exit 1
    fi

    # Hand off to the platform-specific script.
    # FreeBSD uses sh, Linux uses bash, macOS uses zsh — each handles its own shebang.
    if [ "$PLATFORM" = "freebsd" ]; then
        sh "$PLATFORM_SCRIPT" "$@"
    elif [ "$PLATFORM" = "linux" ]; then
        bash "$PLATFORM_SCRIPT" "$@"
    elif [ "$PLATFORM" = "macos" ]; then
        zsh "$PLATFORM_SCRIPT" "$@"
    fi
}

detect_and_dispatch
