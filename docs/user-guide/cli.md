# CLI Usage Guide

The `lycus` command is the primary interface to Autolycus. It supports both an interactive REPL mode and a modern TUI (terminal user interface).

## Starting Lycus

```bash
lycus              # Interactive chat (default)
lycus chat         # Same as above, explicit
lycus --tui        # Terminal UI with visual panels
lycus --cli        # Force classic REPL mode
```

The default interface is controlled by `display.interface` in `config.yaml` (values: `cli` or `tui`). Command-line flags override the config.

## CLI Commands

| Command | Description |
|---------|-------------|
| `lycus` | Start interactive chat session |
| `lycus -q "query"` | Single-query mode: send one message, get response, exit |
| `lycus setup` | Interactive setup wizard (providers, keys, tools) |
| `lycus setup --portal` | Setup with Nous Portal OAuth (single-provider) |
| `lycus model` | List/change LLM provider and model |
| `lycus tools` | Configure which toolsets are enabled |
| `lycus config` | Show current configuration |
| `lycus config edit` | Open config.yaml in your editor |
| `lycus config set key value` | Set a specific config value |
| `lycus gateway start` | Start the messaging gateway service |
| `lycus gateway stop` | Stop the gateway service |
| `lycus gateway status` | Show gateway running status |
| `lycus gateway install` | Install gateway as systemd service |
| `lycus cron list` | List scheduled cron jobs |
| `lycus cron status` | Check if cron scheduler is running |
| `lycus doctor` | Diagnose configuration and dependency issues |
| `lycus update` | Update to the latest version |
| `lycus logout` | Clear stored authentication |
| `lycus uninstall` | Uninstall Autolycus |
| `lycus version` | Show version information |
| `lycus sessions browse` | Interactive session picker with search |
| `lycus acp` | Run as an ACP server for editor integration |

### Honcho Commands (AI Memory Integration)

```bash
lycus honcho setup                    # Configure Honcho memory integration
lycus honcho status                   # Show config and connection status
lycus honcho sessions                 # List directory-to-session mappings
lycus honcho map <name>               # Map current directory to session name
lycus honcho peer                     # Show peer names and dialectic settings
lycus honcho mode [hybrid|honcho|local]  # Set memory mode
lycus honcho tokens                   # Show token budget settings
lycus honcho identity                 # Show AI peer identity
```

### Migration Commands

```bash
lycus claw migrate              # Interactive migration from Hermes/OpenClaw
lycus claw migrate --dry-run    # Preview what would be migrated
lycus claw cleanup              # Archive leftover OpenClaw directories
```

## Slash Commands (In-Session)

Type these during an active conversation:

| Command | Description |
|---------|-------------|
| `/new` or `/reset` | Start a fresh conversation |
| `/new <title>` | New session with custom title |
| `/model [provider:model]` | Change model mid-session |
| `/personality [name]` | Set agent personality |
| `/retry` | Retry the last turn |
| `/undo` | Undo the last assistant response |
| `/compress` | Compress context to reduce token usage |
| `/usage` | Show current session token usage |
| `/insights [--days N]` | Show usage insights over N days |
| `/skills` or `/<skill-name>` | Browse/load skills |
| `/stop` | Interrupt current work (messaging platforms) |
| `/status` | Show session status |
| `/quit` | Exit the session |

## Keyboard Shortcuts

### CLI Mode (REPL)

- **Enter**: Send message
- **Ctrl+C**: Interrupt the agent
- **Ctrl+D**: Exit
- **Up/Down arrows**: Navigate command history
- **Tab**: Autocomplete slash commands

### TUI Mode

The TUI provides visual panels for conversation, tool output, and session management. Mouse tracking is automatically suppressed during startup to prevent terminal escape sequence residue.

## Configuration Files

All configuration lives in `~/.autolycus/`:

```
~/.autolycus/
  config.yaml      # All settings (model, tools, display, etc.)
  .env             # API keys and secrets only
  memories/        # Persistent memory files
    MEMORY.md      # Agent's personal notes
    USER.md        # User profile information
  skills/          # User-created skills
  security.db      # Command tracking database
```

## Environment Variables

- `AUTOLYCUS_HOME`: Override the home directory (default: `~/.autolycus`)
- `HERMES_TUI=1`: Force TUI mode
- `HERMES_YOLO_MODE=1`: Disable command approval prompts (use with caution)
