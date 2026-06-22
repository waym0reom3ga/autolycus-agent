# Configuration Guide

Autolycus uses two configuration files in `~/.autolycus/`:

- **`config.yaml`** -- All behavioral settings (model, tools, display, terminal backend)
- **`.env`** -- API keys and secrets only

The `.env` file is for credentials exclusively. All behavioral settings belong in `config.yaml`, not as environment variables.

## Config File Location

```bash
~/.autolycus/config.yaml    # Main configuration
~/.autolycus/.env           # Secrets (API keys, tokens)
```

Override with the `AUTOLYCUS_HOME` environment variable:

```bash
export AUTOLYCUS_HOME=/custom/path
```

## Managing Configuration

```bash
lycus config              # Show current configuration
lycus config edit         # Open config.yaml in your $EDITOR
lycus config set key value  # Set a specific value programmatically
lycus config wizard       # Re-run the interactive setup wizard
```

## Core Settings

### Model Provider

```yaml
provider: openrouter          # Primary provider name
model: anthropic/claude-sonnet-4  # Default model
```

Supported providers include: `openrouter`, `nous-portal`, `openai`, `anthropic`, `gemini`, `ollama`, `lmstudio`, and custom endpoints.

### Auxiliary Providers

Fallback chain for when the primary provider is unavailable:

```yaml
auxiliary_providers:
  - provider: openai
    model: gpt-4o
  - provider: ollama
    model: qwen3.6-27b-mtp
```

### Custom Provider Endpoint

For self-hosted models (e.g., LM Studio, Ollama, vLLM):

```yaml
provider: custom
model: your-model-name
custom_providers:
  my_local:
    base_url: http://localhost:1234/v1
    api_key: not-needed
```

### Toolsets

Control which tools the agent has access to:

```yaml
toolsets:
  - web           # web_search, web_extract
  - terminal      # terminal, process
  - file          # read_file, write_file, patch, search_files
  - browser       # Full browser automation suite
  - skills        # skills_list, skill_view, skill_manage
  - memory        # Persistent memory operations
  - delegation    # delegate_task (subagent spawning)
  - cronjob       # Scheduled task management
```

### Display Settings

```yaml
display:
  interface: cli          # "cli" for REPL or "tui" for terminal UI
```

### Terminal Backend

Where the agent runs shell commands:

```yaml
terminal:
  backend: local           # local, docker, ssh, modal, daytona
```

## .env File (Secrets Only)

Store API keys and credentials in `~/.autolycus/.env`:

```
OPENROUTER_API_KEY=sk-or-...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...:...
```

The setup wizard writes these automatically. Never commit `.env` to version control.

## Protected Environment Variables

The following environment variables cannot be written through the dashboard or config tools (security measure):

- `LD_PRELOAD`, `LD_LIBRARY_PATH` -- Dynamic loader
- `PYTHONPATH`, `PYTHONHOME` -- Python interpreter
- `NODE_OPTIONS`, `NODE_PATH` -- Node.js runtime
- `PATH`, `SHELL`, `EDITOR`, `VISUAL`, `PAGER` -- Shell behavior
- `GIT_SSH_COMMAND`, `GIT_EXEC_PATH` -- Git operations
- `AUTOLYCUS_HOME`, `HERMES_PROFILE`, `HERMES_CONFIG` -- Runtime location

## Config Recovery

If `config.yaml` becomes corrupted (invalid YAML), Autolycus:

1. Falls back to built-in defaults
2. Warns on stderr and in logs (`agent.log`, `errors.log`)
3. Creates a timestamped backup: `config.yaml.corrupt.YYYYMMDD-HHMMSS.bak`
4. Re-warns automatically when the file changes (so you see fixes)

The corrupted file is left in place so you can hand-fix it -- Autolycus never silently overwrites your config.

## Profile-Specific Configuration

Each Lycus profile has its own configuration directory under `~/.autolycus/profiles/<name>/` with separate skills, plugins, cron jobs, and memories.
