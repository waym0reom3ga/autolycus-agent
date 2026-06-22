# Quick Start Guide

Get Autolycus up and running in under 5 minutes.

## Prerequisites

- **Supported platforms:**
  - FreeBSD 14.x / 15.0 (amd64) — native support, no emulation needed
  - Linux (amd64/aarch64) — Arch Linux, Ubuntu, Fedora, Debian tested
  - macOS (reported working)
- **Rust/Cargo** installed (`pkg install rust` on FreeBSD, `rustup` on Linux/macOS)
- **Python 3.11+** available (the installer can fetch it via `uv` if missing)
- Optional: SQLite for persistent memory and session tracking

## Installation

### Automated Install (Recommended)

```bash
# Clone the repository
git clone https://github.com/waym0reom3ga/autolycus-agent.git
cd autolycus-agent

# Run the installer — auto-detects your OS
sh scripts/install-autolycus.sh
```

The installer handles everything:

1. Detects your operating system (FreeBSD / Linux / macOS)
2. Installs `uv` via cargo if not present
3. Creates a virtual environment with Python 3.11
4. Installs all dependencies (voice tools excluded on FreeBSD due to missing wheels)
5. Symlinks the `lycus` command into `~/.local/bin/lycus`
6. Sets up config files from templates
7. Syncs bundled skills

### Manual Install (FreeBSD)

```bash
git clone https://github.com/waym0reom3ga/autolycus-agent.git
cd autolycus-agent

# Build uv from source (~4 min compile, no FreeBSD binary available)
cargo install uv
export PATH="$HOME/.cargo/bin:$PATH"

# Create virtual environment
uv venv venv --python 3.11
source venv/bin/activate

# Install dependencies (excluding voice which has no FreeBSD wheels)
uv pip install -e ".[modal,daytona,messaging,cron,cli,dev,tts-premium,slack,honcho,mcp]"

# Add lycus to PATH
mkdir -p ~/.local/bin
ln -sf $(pwd)/venv/bin/lycus ~/.local/bin/lycus
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

### Manual Install (Linux)

```bash
git clone https://github.com/waym0reom3ga/autolycus-agent.git
cd autolycus-agent

# uv can be installed from pre-built binary on Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.local/bin/env  # or restart your shell

uv venv venv --python 3.11
source venv/bin/activate

# Full stack including voice tools on Linux
uv pip install -e ".[all]"

mkdir -p ~/.local/bin
ln -sf $(pwd)/venv/bin/lycus ~/.local/bin/lycus
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

## First-Time Setup

After installation, reload your shell and run the setup wizard:

```bash
source ~/.bashrc    # or source ~/.zshrc on macOS
lycus setup         # interactive configuration wizard
```

The `lycus setup` wizard walks you through:

- **Model provider selection** — choose from 28+ providers (OpenRouter, Nous Portal, OpenAI, Anthropic, Gemini, Ollama, etc.)
- **API key entry** — securely stored in `~/.autolycus/.env`
- **Tool configuration** — which capabilities to enable
- **Terminal backend** — local, Docker, SSH, Modal, or Daytona

### Quick Setup with Nous Portal

If you want a single-provider setup covering models, web search, image generation, TTS, and browser automation:

```bash
lycus setup --portal
```

This logs in via OAuth to [Nous Portal](https://portal.nousresearch.com), sets it as your provider, and enables the Tool Gateway. No separate API keys needed.

### Non-Interactive Setup

For scripted or CI environments:

```bash
# Set your API key in .env first
echo "OPENROUTER_API_KEY=sk-or-..." >> ~/.autolycus/.env

lycus setup --non-interactive
```

## Your First Conversation

Start the interactive CLI:

```bash
lycus
```

You'll see the Autolycus banner and a prompt. Type your message and press Enter:

```
🔱 Lycus Agent v2.x.x (FreeBSD/Linux/macOS)
> Explain how async/await works in Python
```

The agent will respond with tool calls visible as they execute, streaming output to your terminal.

### Key Interactions

| Action | How |
|--------|-----|
| Send a message | Type and press Enter |
| Interrupt the agent | `Ctrl+C` |
| Start a new conversation | `/new` or `/reset` |
| Change model mid-session | `/model openrouter:anthropic/claude-sonnet-4-20250514` |
| See available tools | `/tools list` |
| Check session status | `/status` |
| Exit | `/quit` or `Ctrl+D` |

## Verify Everything Works

```bash
# Check your configuration is valid
lycus doctor

# See what's configured
lycus status

# Run a quick test conversation
lycus -q "What operating system am I running?"
```

The `-q` flag runs in single-query mode: sends one message, gets a response, then exits. Great for testing and scripting.

## Next Steps

- **[CLI Reference](../user-guide/cli.md)** — All commands and slash commands
- **[Configuration Guide](../user-guide/configuration.md)** — Deep dive into `config.yaml`
- **Messaging Gateway** — Run Autolycus on Telegram, Discord, Slack, WhatsApp: `lycus gateway setup`
