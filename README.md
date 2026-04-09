<p align="center">
  <img src="assets/banner.png" alt="Autolycus" width="100%">
</p>

# Autolycus 🦊

<p align="center">
  <a href="https://github.com/waym0reom3ga/autolycus-agent"><img src="https://img.shields.io/badge/GitHub-waym0reom3ga/autolycus--agent-6e5494?style=for-the-badge&logo=github" alt="GitHub"></a>
  <a href="https://github.com/waym0reom3ga/autolycus-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-LGPL%20v2.1-blue?style=for-the-badge" alt="License: LGPL v2.1"></a>
  <img src="https://img.shields.io/badge/FreeBSD-AB1D2E?style=for-the-badge&logo=freebsd&logoColor=white" alt="FreeBSD Only">
  <img src="https://img.shields.io/badge/Technetia%20Inc-0066cc?style=for-the-badge" alt="Technetia Inc">
</p>

> ⚠️ **PROTOTYPE / FreeBSD ONLY** — This is an unworking prototype designed exclusively for FreeBSD systems. Not production-ready. An independent project by **Technetia Inc**. Not affiliated with Nous Research or the original Hermes Agent.

**The self-improving AI agent.** It's the only agent (apart from Hermes) with a built-in learning loop — it creates skills from experience, improves them during use, nudges itself to persist knowledge, searches its own past conversations, and builds a deepening model of who you are across sessions. Run it on a $5 VPS, a GPU cluster, or serverless infrastructure that costs nearly nothing when idle. It's not tied to your laptop — talk to it from Telegram while it works on a cloud VM.

Use any model you want — [Nous Portal](https://portal.nousresearch.com), [OpenRouter](https://openrouter.ai) (200+ models), [z.ai/GLM](https://z.ai), [Kimi/Moonshot](https://platform.moonshot.ai), [MiniMax](https://www.minimax.io), OpenAI, or your own endpoint. Switch with `hermes model` — no code changes, no lock-in.

<table>
<tr><td><b>A real terminal interface</b></td><td>Full TUI with multiline editing, slash-command autocomplete, conversation history, interrupt-and-redirect, and streaming tool output.</td></tr>
<tr><td><b>Lives where you do</b></td><td>Telegram, Discord, Slack, WhatsApp, Signal, and CLI — all from a single gateway process. Cross-platform conversation continuity.</td></tr>
<tr><td><b>A closed learning loop</b></td><td>Agent-curated memory with periodic nudges. Autonomous skill creation after complex tasks. Skills self-improve during use. FTS5 session search with LLM summarization for cross-session recall. <a href="https://github.com/plastic-labs/honcho">Honcho</a> dialectic user modeling. Compatible with the <a href="https://agentskills.io">agentskills.io</a> open standard.</td></tr>
<tr><td><b>Scheduled automations</b></td><td>Built-in cron scheduler with delivery to any platform. Daily reports, nightly backups, weekly audits — all in natural language, running unattended.</td></tr>
<tr><td><b>Delegates and parallelizes</b></td><td>Spawn isolated subagents for parallel workstreams. Write Python scripts that call tools via RPC, collapsing multi-step pipelines into zero-context-cost turns.</td></tr>
<tr><td><b>Runs on FreeBSD</b></td><td>Native FreeBSD build — no Linux emulation required. Terminal backends: local, Docker, SSH, Daytona, and Modal.</td></tr>
<tr><td><b>Research-ready</b></td><td>Batch trajectory generation, Atropos RL environments, trajectory compression for training the next generation of tool-calling models.</td></tr>
</table>

---

## Quick Install (FreeBSD Only)

⚠️ **This prototype runs on FreeBSD only.** Linux/macOS users should use the original [Hermes Agent](https://github.com/NousResearch/hermes-agent).

### Prerequisites

- FreeBSD 13+ 
- Rust/Cargo installed (`pkg install rust`)
- Python 3.11+ (`pkg install python311`)

### Installation

```bash
# Clone the repository
git clone https://github.com/waym0reom3ga/autolycus-agent.git
cd autolycus-agent

# Build uv from source (no FreeBSD binary available)
cargo install uv
export PATH="$HOME/.cargo/bin:$PATH"

# Create virtual environment
uv venv venv --python 3.11
source venv/bin/activate

# Install dependencies (excluding voice/pty which don't work on FreeBSD)
uv pip install -e ".[modal,daytona,messaging,cron,cli,dev,tts-premium,slack,honcho,mcp]"

# Add hermes to PATH
mkdir -p ~/.local/bin
ln -sf $(pwd)/venv/bin/hermes ~/.local/bin/hermes
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

After installation:

```bash
source ~/.bashrc    # reload shell
hermes setup        # configure API keys
hermes              # start chatting!
```

---

## Getting Started

```bash
hermes              # Interactive CLI — start a conversation
hermes model        # Choose your LLM provider and model
hermes tools        # Configure which tools are enabled
hermes config set   # Set individual config values
hermes gateway      # Start the messaging gateway (Telegram, Discord, etc.)
hermes setup        # Run the full setup wizard (configures everything at once)
hermes claw migrate # Migrate from OpenClaw (if coming from OpenClaw)
hermes update       # Update to the latest version
hermes doctor       # Diagnose any issues
```

📖 **Documentation:** See [Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/) for reference (Autolycus is (or, more accurately, aims to be) API-compatible).

## CLI vs Messaging Quick Reference

Autolycus has two entry points: start the terminal UI with `hermes`, or run the gateway and talk to it from Telegram, Discord, Slack, WhatsApp, Signal, or Email. Once you're in a conversation, many slash commands are shared across both interfaces.

| Action | CLI | Messaging platforms |
|---------|-----|---------------------|
| Start chatting | `hermes` | Run `hermes gateway setup` + `hermes gateway start`, then send the bot a message |
| Start fresh conversation | `/new` or `/reset` | `/new` or `/reset` |
| Change model | `/model [provider:model]` | `/model [provider:model]` |
| Set a personality | `/personality [name]` | `/personality [name]` |
| Retry or undo the last turn | `/retry`, `/undo` | `/retry`, `/undo` |
| Compress context / check usage | `/compress`, `/usage`, `/insights [--days N]` | `/compress`, `/usage`, `/insights [days]` |
| Browse skills | `/skills` or `/<skill-name>` | `/skills` or `/<skill-name>` |
| Interrupt current work | `Ctrl+C` or send a new message | `/stop` or send a new message |
| Platform-specific status | `/platforms` | `/status`, `/sethome` |

For the full command lists, see the [CLI guide](https://hermes-agent.nousresearch.com/docs/user-guide/cli) and the [Messaging Gateway guide](https://hermes-agent.nousresearch.com/docs/user-guide/messaging).

---

## Documentation

Autolycus is API-compatible with Hermes Agent. For full documentation, refer to the **[Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/)**.

| Section | What's Covered |
|---------|---------------|
| [Quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart) | Install → setup → first conversation in 2 minutes |
| [CLI Usage](https://hermes-agent.nousresearch.com/docs/user-guide/cli) | Commands, keybindings, personalities, sessions |
| [Configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) | Config file, providers, models, all options |
| [Messaging Gateway](https://hermes-agent.nousresearch.com/docs/user-guide/messaging) | Telegram, Discord, Slack, WhatsApp, Signal, Home Assistant |
| [Security](https://hermes-agent.nousresearch.com/docs/user-guide/security) | Command approval, DM pairing, container isolation |
| [Tools & Toolsets](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools) | 40+ tools, toolset system, terminal backends |
| [Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) | Procedural memory, Skills Hub, creating skills |
| [Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) | Persistent memory, user profiles, best practices |
| [MCP Integration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) | Connect any MCP server for extended capabilities |
| [Cron Scheduling](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron) | Scheduled tasks with platform delivery |

> **Note:** Autolycus is a FreeBSD-only prototype. Some features (voice, pty terminal backends) are unavailable due to missing FreeBSD wheels for certain dependencies.

---

## Migrating from Hermes/OpenClaw

If you're coming from Hermes or OpenClaw, Autolycus can automatically import your settings, memories, skills, and API keys.

**During first-time setup:** The setup wizard (`hermes setup`) automatically detects `~/.openclaw` and offers to migrate before configuration begins.

**Anytime after install:**

```bash
hermes claw migrate              # Interactive migration (full preset)
hermes claw migrate --dry-run    # Preview what would be migrated
hermes claw migrate --preset user-data   # Migrate without secrets
hermes claw migrate --overwrite  # Overwrite existing conflicts
```

What gets imported:
- **SOUL.md** — persona file
- **Memories** — MEMORY.md and USER.md entries
- **Skills** — user-created skills → `~/.hermes/skills/openclaw-imports/`
- **Command allowlist** — approval patterns
- **Messaging settings** — platform configs, allowed users, working directory
- **API keys** — allowlisted secrets (Telegram, OpenRouter, OpenAI, Anthropic, ElevenLabs)
- **TTS assets** — workspace audio files
- **Workspace instructions** — AGENTS.md (with `--workspace-target`)

See `hermes claw migrate --help` for all options, or use the `openclaw-migration` skill for an interactive agent-guided migration with dry-run previews.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR process.

Quick start for contributors (FreeBSD only):

```bash
git clone https://github.com/waym0reom3ga/autolycus-agent.git
cd autolycus-agent
cargo install uv  # Build uv from source (no FreeBSD binary available)
export PATH="$HOME/.cargo/bin:$PATH"
uv venv venv --python 3.11
source venv/bin/activate
# Note: [all] extras include voice/pty which don't work on FreeBSD
uv pip install -e ".[modal,daytona,messaging,cron,cli,dev,tts-premium,slack,honcho,mcp]"
python -m pytest tests/ -q
```

> **Note:** This is a FreeBSD-only prototype. The `voice` and `pty` extras are not available due to missing FreeBSD wheels for dependencies like `ctranslate2`.

---

## Community

- 🐛 [Issues](https://github.com/waym0reom3ga/autolycus-agent/issues) — Report bugs or request features
- 📧 **Technetia Inc** — Contact us for enterprise support or inquiries

---

## License

LGPL v2.1 — see [LICENSE](LICENSE).

An independent project by **Technetia Inc**.  
Built on the Hermes Agent architecture.
