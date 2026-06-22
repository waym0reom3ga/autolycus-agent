# Security Guide

Autolycus implements multiple security layers to prevent unauthorized actions while maintaining usability.

## Command Approval System

The dangerous command detection system intercepts potentially harmful shell commands before execution.

### How It Works

1. **Pattern Detection**: Commands matching known-dangerous patterns trigger an approval prompt
2. **Per-Session State**: Approval state is tracked per session using thread-safe context variables
3. **Smart Auto-Approval**: Low-risk commands can be auto-approved by an auxiliary LLM analysis
4. **Permanent Allowlist**: Frequently approved commands can be persisted in `config.yaml`

### Dangerous Command Patterns

The system detects patterns including:

- Package manager operations (`pacman`, `apt`, `pip install --break-system-packages`)
- System file modifications (`/etc/sudoers`, `/etc/passwd`)
- Destructive operations (`rm -rf /`, disk formatting)
- Credential access (reading `.env`, `.netrc`, credential files)
- Network binding and port forwarding

### Approval Modes

```yaml
approvals:
  mode: interactive       # Prompt for each dangerous command
  cron_mode: deny         # Cron jobs default to denied
  yolo: false             # Set HERMES_YOLO_MODE=1 to disable all prompts (dangerous)
```

**YOLO Mode**: When `HERMES_YOLO_MODE=1`, all approval checks are bypassed. This is frozen at module import time -- skills cannot set this variable mid-session to bypass security.

### Session Boundary Security

When you type `/new` or `/reset`, the system clears:
- Session-scoped dangerous-command approvals
- YOLO state from previous conversation
- Model/reasoning overrides
- Environment passthrough state
- Credential file handles

This prevents approval state from bleeding across conversations.

## Rogue AI Policy

Prevents agent loops from causing platform bans by tracking command frequency per session.

### Database

Stored in `~/.autolycus/security.db` with two tables:

- **command_logs**: Every command attempt (persistent, queried per-session)
- **session_log**: Append-only audit trail of all session output

### Guard Rules

| Command Type | Block Threshold | Time Window |
|--------------|-----------------|-------------|
| Non-web commands | 3+ identical attempts | Past 24 hours |
| Web commands | 2+ identical attempts | Past hour |
| Hard halt | 4+ attempts of a blocked command | Past 24 hours |

Older entries remain in the archive for audit but never trigger blocks.

## DM Pairing and Authorization

The gateway restricts access through user allowlists per platform:

```yaml
gateway:
  platforms:
    telegram:
      allowed_users: ["@username1", "123456789"]
    discord:
      allowed_users: ["user_id_1", "user_id_2"]
```

Users not in the allowlist cannot start conversations with the agent.

## Environment Variable Protection

The following environment variables are blocked from being written through the dashboard or config tools (prevents RCE escalation):

- **Loader/linker**: `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`
- **Python runtime**: `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`
- **Node.js**: `NODE_OPTIONS`, `NODE_PATH`
- **Shell behavior**: `PATH`, `SHELL`, `EDITOR`, `VISUAL`, `PAGER`
- **Git**: `GIT_SSH_COMMAND`, `GIT_EXEC_PATH`
- **Lycus runtime**: `AUTOLYCUS_HOME`, `HERMES_PROFILE`, `HERMES_CONFIG`

Values already in `.env` (set manually) continue working -- the restriction only applies to programmatic writes.

## Webhook Security

Webhook-triggered sessions use a restricted toolset (`_HERMES_WEBHOOK_SAFE_TOOLS`) containing only:
- `web_search`, `web_extract` (read-only web access)
- `vision_analyze` (image analysis)
- `clarify` (user interaction)

No terminal, file system, or browser automation is available to webhook sessions.

## Cron Job Security

Cron prompts are scanned for threat patterns at creation time:

- Prompt injection directives ("ignore previous instructions")
- Secret reading commands (`cat ~/.autolycus/.env`)
- SSH backdoor attempts (modifying `authorized_keys`)
- Destructive operations (`rm -rf /`)
- Invisible Unicode characters

When skills are attached to cron jobs, a looser pattern set is used to avoid false positives on security documentation that describes attack patterns in prose.

## Best Practices

1. **Never enable YOLO mode** unless you fully trust the agent and model
2. **Review the allowlist regularly**: `lycus config edit` -> check `approvals.allowed_commands`
3. **Use platform-specific allowed_users** to restrict gateway access
4. **Monitor security.db** for unusual command patterns: `sqlite3 ~/.autolycus/security.db "SELECT * FROM command_logs ORDER BY timestamp DESC LIMIT 20"`
5. **Keep `.env` file permissions restrictive**: `chmod 600 ~/.autolycus/.env`
