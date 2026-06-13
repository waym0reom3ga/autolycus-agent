```
 ░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░▒▓██████▓▒░░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓███████▓▒░ 
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░    ░▒▓██████▓▒░░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░  
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░   ░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░      ░▒▓█▓▒░ 
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░      ░▒▓█▓▒░ 
░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░   ░▒▓█▓▒░   ░▒▓██████▓▒░░▒▓████████▓▒░▒▓█▓▒░    ░▒▓██████▓▒░ ░▒▓██████▓▒░░▒▓███████▓▒░  

                A U T O L Y C U S
              v e r s i o n  0 . 0 . 4
```

---

## Release Notes — Autolycus v0.0.4

**Release Date:** May 4, 2026  
**Platform:** FreeBSD, Linux, macOS  
**License:** LGPL v2.1

### About This Release

Autolycus v0.0.4 introduces the **automated cross-platform installer** — a single script that handles OS detection, dependency installation, virtual environment setup, and configuration for FreeBSD, Linux, and macOS. No more manual step-by-step instructions; just clone and run.

This release also expands Autolycus platform support beyond FreeBSD to include Linux and macOS, while maintaining FreeBSD as the primary development and testing target.

---

### What's New

#### 🚀 Automated Installer Script

**New:** `scripts/install-autolycus.sh`

The installer automates the entire setup process:

1. **OS Detection** — Automatically identifies FreeBSD, Linux, or macOS
2. **Prerequisite Checks** — Verifies Rust/Cargo and `make` are installed, with platform-specific install instructions if missing
3. **uv Installation** — Installs uv via cargo (skips if already present at `~/.cargo/bin`, `~/.local/bin`, or in PATH)
4. **Virtual Environment** — Creates a Python 3.11 venv with proper POSIX-compatible activation
5. **Smart Dependency Installation** — Installs OS-appropriate extras:
   - FreeBSD: excludes voice tools (no ctranslate2 wheels)
   - Linux/macOS: includes voice tools
6. **CLI Setup** — Creates symlink in `~/.local/bin` and appends PATH to shell config
7. **Config Templates** — Creates `AGENTS.md` and `persona.md` from templates
8. **Skill Sync** — Runs `hermes skills sync` to install bundled skills
9. **FreeBSD Warnings** — Reminds FreeBSD users about `python-sqlite` and voice limitations

**Usage:**
```bash
git clone https://github.com/waym0reom3ga/autolycus-agent.git
cd autolycus-agent
./scripts/install-autolycus.sh
```

#### 🐧 Expanded Platform Support

Autolycus now officially supports three platforms:

| Platform | Status | Notes |
|----------|--------|-------|
| FreeBSD | ✅ Primary | Native development target, tested on FreeBSD 15.0 |
| Linux | ✅ Supported | Full feature set including voice tools |
| macOS | ✅ Supported | Full feature set including voice tools |

The installer detects your OS and applies platform-specific configurations automatically.

---

### Technical Changes

#### Files Added (1 new file)

| File | Lines | Description |
|------|-------|-------------|
| `scripts/install-autolycus.sh` | 411 | Automated cross-platform installer script |

#### Files Modified (1 file)

| File | Changes | Description |
|------|---------|-------------|
| `README.md` | Updated install section, badges, tagline, contributing section | Reflected new installer and multi-platform support |

---

### What Works (Inherited from v0.0.3)

| Feature | Status | Notes |
|---------|--------|-------|
| Terminal execution | ✅ Working | PTY-based, interrupt/timeout support |
| File operations | ✅ Working | Read, write, edit, search files |
| Web browsing | ✅ Working | Firecrawl and Parallel web tools |
| GitHub integration | ✅ Working | Issues, PRs, repo search |
| Memory system | ✅ Working | Persistent memory with FTS5 search |
| Skills system | ✅ Working | 71 built-in skills available |
| CLI interface | ✅ Working | Full TUI with streaming output (Autolycus theme) |
| Model providers | ✅ Working | LM Studio, Ollama, OpenRouter, etc. |
| Voice (Linux/macOS) | ✅ Working | faster-whisper available on Linux/macOS |
| Voice (FreeBSD) | ❌ Unavailable | faster-whisper has no FreeBSD wheels |

---

### Known Limitations (Unchanged)

1. **Voice tools unavailable on FreeBSD** — `faster-whisper` depends on `ctranslate2`, which has no FreeBSD wheels. Use cloud-based alternatives:
   - Set `GROQ_API_KEY` for Groq-powered STT
   - Set `VOICE_TOOLS_OPENAI_KEY` for OpenAI Whisper API

2. **Clipboard support requires xclip/xsel** — Install with `pkg install xclip` (FreeBSD) or your package manager

3. **uv must be built from source on FreeBSD** — No FreeBSD binary available; expect ~4 minute compile time with `cargo install uv`. On Linux/macOS, uv is installed the same way but builds faster.

---

### Installation (Updated)

```bash
git clone https://github.com/waym0reom3ga/autolycus-agent.git
cd autolycus-agent
./scripts/install-autolycus.sh
source ~/.bashrc
hermes setup
hermes
```

That's it. The installer handles everything else.

---

### Upgrade from v0.0.3

If you already have v0.0.3 installed:

```bash
cd autolycus-agent
git pull
./scripts/install-autolycus.sh  # re-runs safely, skips what's already done
```

Or manually:

```bash
cd autolycus-agent
git pull
. venv/bin/activate
uv pip install -e ".[modal,daytona,messaging,cron,cli,dev,tts-premium,slack,honcho,mcp]" --upgrade
```

---

### Credits

Built on the [Hermes Agent](https://github.com/NousResearch/hermes-agent) architecture by Nous Research.  
An independent project by **Technetia Inc**.

Special thanks to:
- The FreeBSD community for maintaining a world-class Unix operating system
- The Arch Linux community for excellent package management
- All contributors who made the TUI rebranding in v0.0.3 possible

---

### What's Next?

**v0.0.5 and beyond:**
- Cross-platform test suite (FreeBSD/Linux/macOS CI)
- Installer package manager integration (pkg, pipx, homebrew)
- FreeBSD-specific performance optimizations
- Community-contributed skins and themes

Stay tuned! 🦊

---

*The world's first AI agent for FreeBSD — now on Linux and macOS too.*
