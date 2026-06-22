# Memory Guide

Autolycus provides two complementary persistence mechanisms: curated file-backed memory for durable facts, and full-text session search for conversation history recall.

## Persistent Memory (MEMORY.md / USER.md)

File-backed memory that persists across sessions. Two stores:

- **`MEMORY.md`**: Agent's personal notes -- environment facts, project conventions, tool quirks, lessons learned
- **`USER.md`**: What the agent knows about you -- preferences, communication style, expectations, workflow habits

Both files live in `~/.autolycus/memories/`.

### How It Works

1. At session start, both files are read and injected into the system prompt as a frozen snapshot
2. Mid-session writes update files on disk immediately (durable) but do NOT change the active system prompt -- this preserves the LLM prefix cache for the entire conversation
3. The snapshot refreshes on the next session start

### Entry Format

Entries are separated by `§` (section sign). Entries can be multiline:

```
User prefers concise responses, no fluff.§
Project uses pytest with xdist for parallel test execution.§
Custom LLM provider at http://192.168.1.50:1234/v1.§
```

### Character Limits

Memory has a character limit (not tokens) to keep the system prompt manageable. When full, you must consolidate entries using `replace` or remove stale ones before adding new content.

### Memory Tool Actions

```python
# Add a new entry
memory(action="add", target="user", content="User prefers Celsius for temperature")

# Replace an existing entry (match by unique substring)
memory(action="replace", target="memory", old_text="Old fact here", content="Updated fact")

# Remove an entry
memory(action="remove", target="user", old_text="Substring to find and remove")

# Read current memory state
memory(action="read", target="user")    # or "memory"
```

### What To Store

**Store (durable facts):**
- User preferences and corrections ("never use grep, use search_files instead")
- Environment details (OS, installed tools, project structure)
- API quirks and discovered workflows
- Stable conventions that will be useful again

**Do NOT store (temporary state):**
- Task progress or session outcomes
- Completed work logs or raw data dumps
- PR numbers, issue numbers, commit SHAs
- Anything stale in a week -- use `session_search` instead

## Session Search (FTS5)

Full-text search over past conversation history stored in SQLite. Zero LLM cost -- every query returns actual messages from the database.

### Three Calling Modes

**1. Discovery** -- Search by keyword:
```python
session_search(query="auth refactor", limit=3)
```
Returns top matching sessions with: snippet, +/-5 message window around the match, plus bookend_start (first 3 messages) and bookend_end (last 3 messages).

**2. Scroll** -- Navigate within a session:
```python
session_search(session_id="abc123", around_message_id=456, window=10)
```
Returns a window of messages centered on the anchor. To scroll forward, pass the last message's ID back as `around_message_id`.

**3. Browse** -- Recent sessions:
```python
session_search()  # No args = chronological recent sessions
```

### FTS5 Search Syntax

- **AND is default**: Multi-word queries require all terms
- **OR for broader recall**: `"alpha OR beta OR gamma"`
- **Quoted phrases**: `"docker networking"` for exact match
- **Boolean**: `python NOT java`
- **Prefix wildcards**: `deploy*`

### Hidden Sessions

Sessions from subagent runs (source: "subagent") and third-party integrations (source: "tool") are excluded from browsing by default.

## User Profiles

Each Lycus profile has isolated memory, skills, plugins, and cron jobs under `~/.autolycus/profiles/<name>/`. Switch profiles to maintain separate agent contexts for different projects or roles.
