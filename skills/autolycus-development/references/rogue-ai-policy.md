---
name: rogue-ai-policy
category: autolycus-development
description: Persistent command tracking and session logging to prevent agent loops from causing bans
---

# Rogue AI Policy

Protective measure for the Lycus agent society. Prevents individual agents from getting banned by enforcing hard limits on repeated commands, especially web-related ones that could trigger rate limiting or IP bans.

## Architecture

**Database**: `~/.autolycus/security.db` (persistent SQLite)

**Tables**:
- `command_logs`: key, command, session_id, web (bool), timestamp
- `session_log`: key, session_id, item (every line/chunk of output)

## Guard Queries

Two simple queries run before every command execution:

1. **Non-web commands**: `COUNT(*) > 2` for same command + session_id → block with "you've been looping, stop it now"
2. **Web commands** (wget/curl/git): `COUNT(*) > 1` within past hour → block with "you're spamming the internet, stop it and reassess what you need from what you already did"
3. **Hard halt**: 4+ attempts of same command in session → absolute termination with "Operation halted: rogue AI detected"

## Integration Points

- `tools/rogue_ai_policy.py`: Core module with DB schema, guard queries, logging functions
- `tools/approval.py`: Hooked into `check_all_command_guards()` BEFORE existing repeated-command guard
- `agent/conversation_loop.py`: Session logging hooks for user messages, assistant output, tool calls/results, compression events

## Hard Halt Mechanism

When a command hits 4+ attempts:
1. Marker file written to `~/.autolycus/hard_halt_<session_id>`
2. Agent loop detects marker at start of each iteration
3. Session terminates immediately with "rogue_ai_hard_halt" exit reason
4. Marker persists as audit trail (cleared manually or by `clear_hard_halt()`)

## Session Logging

Every line/chunk logged separately to session_log:
- `[user]` - user messages at conversation start
- `[assistant]` - assistant text output lines
- `[tool_call] tool_name` + args preview
- `[tool_result] tool_name` + result preview
- `[system]` - compression events, context changes

## Philosophy

One looping agent gets all banned. The Rogue AI Policy protects the whole society by enforcing discipline on individual agents. Better to halt a session than risk an IP ban that affects every Lycus instance on the network.
