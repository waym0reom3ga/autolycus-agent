"""Rogue AI Policy - Persistent command tracking and session logging.

Prevents agent loops from causing bans by maintaining a persistent SQLite
database that tracks commands per-session with global web-command limits.

Database: ~/.autolycus/security.db
Tables:
    command_logs  - every command attempt (persistent, queried per-session)
    session_log   - every line/chunk of session output (append-only audit trail)

Guard queries:
    Non-web: COUNT(*) > 2 for same command + session_id -> block
    Web:     COUNT(*) > 1 for same command + session_id within past hour -> block
    Hard halt on 4th+ attempt of a blocked command.
"""

import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Tuple

logger = None  # Lazy-loaded to avoid circular imports


def _get_logger():
    global logger
    if logger is None:
        import logging
        logger = logging.getLogger(__name__)
    return logger


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------

_SECURITY_DB_DIR = Path(os.environ.get("HOME", "~")).expanduser() / ".autolycus"
_SECURITY_DB_PATH = _SECURITY_DB_DIR / "security.db"
_lock = threading.Lock()


def _get_connection() -> sqlite3.Connection:
    """Return a connection to the security database, creating it if needed."""
    _SECURITY_DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_SECURITY_DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    _ensure_tables(conn)
    return conn


def _ensure_tables(conn: sqlite3.Connection):
    """Create tables if they don't exist."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS command_logs (
            key INTEGER PRIMARY KEY AUTOINCREMENT,
            command TEXT NOT NULL,
            session_id TEXT NOT NULL,
            web INTEGER NOT NULL DEFAULT 0,
            timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_command_logs_session_command
            ON command_logs(session_id, command);

        CREATE TABLE IF NOT EXISTS session_log (
            key INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            item TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_log_session
            ON session_log(session_id);
    """)
    conn.commit()


# ---------------------------------------------------------------------------
# Command logging and guard queries
# ---------------------------------------------------------------------------

_WEB_PATTERN = re.compile(r'\b(wget|curl|git)\b')


def _is_web_command(command: str) -> bool:
    """Check if command contains wget, curl, or git."""
    return bool(_WEB_PATTERN.search(command))


def check_command_guard(session_id: str, command: str) -> Tuple[bool, Optional[str]]:
    """Run the two guard queries and return (blocked, message).

    Returns:
        (False, None) if allowed.
        (True, "you've been looping...") for non-web repeat > 2.
        (True, "you're spamming the internet...") for web repeat > 1 within hour.
        (True, "Operation halted: rogue AI detected") for hard halt on 4th+.
    """
    with _lock:
        conn = _get_connection()
        try:
            is_web = _is_web_command(command)

            # Count total attempts for this command in this session
            row = conn.execute(
                "SELECT COUNT(*) FROM command_logs WHERE command = ? AND session_id = ?",
                (command, session_id),
            ).fetchone()
            total_count = row[0] if row else 0

            # Hard halt: 4+ attempts of the same command in this session
            if total_count >= 4:
                # Write a hard halt marker file that the agent loop can detect
                _write_hard_halt_marker(session_id)
                return (True, "Operation halted: rogue AI detected")

            if is_web:
                # Web commands: block after 1 repeat within past hour
                cutoff = (datetime.utcnow() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
                row = conn.execute(
                    "SELECT COUNT(*) FROM command_logs WHERE command = ? AND session_id = ? AND timestamp >= ?",
                    (command, session_id, cutoff),
                ).fetchone()
                recent_count = row[0] if row else 0

                if recent_count > 1:
                    return (True, "you're spamming the internet, stop it and reassess what you need from what you already did")
            else:
                # Non-web commands: block after count > 2 in this session
                if total_count > 2:
                    return (True, "you've been looping, stop it now")

            # Log the command attempt BEFORE execution
            conn.execute(
                "INSERT INTO command_logs (command, session_id, web, timestamp) VALUES (?, ?, ?, ?)",
                (command, session_id, int(is_web), datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
            )
            conn.commit()

        except Exception as e:
            _get_logger().warning("Rogue AI policy check failed: %s", e)
            # Fail open - don't block if DB is unavailable
        finally:
            conn.close()

    return (False, None)


def _write_hard_halt_marker(session_id: str):
    """Write a marker file that signals the agent loop to terminate."""
    try:
        marker_dir = Path(os.environ.get("HOME", "~")).expanduser() / ".autolycus"
        marker_dir.mkdir(parents=True, exist_ok=True)
        marker_file = marker_dir / f"hard_halt_{session_id}"
        marker_file.write_text(f"HARD HALT: Rogue AI detected at {datetime.utcnow().isoformat()}")
    except Exception as e:
        _get_logger().warning("Failed to write hard halt marker: %s", e)


def check_hard_halt(session_id: str) -> bool:
    """Check if a hard halt has been triggered for this session.

    Call this from the agent loop to detect and respond to rogue AI halts.
    Returns True if the agent should terminate immediately.
    """
    try:
        marker_dir = Path(os.environ.get("HOME", "~")).expanduser() / ".autolycus"
        marker_file = marker_dir / f"hard_halt_{session_id}"
        return marker_file.exists()
    except Exception:
        return False


def clear_hard_halt(session_id: str):
    """Clear the hard halt marker for this session."""
    try:
        marker_dir = Path(os.environ.get("HOME", "~")).expanduser() / ".autolycus"
        marker_file = marker_dir / f"hard_halt_{session_id}"
        if marker_file.exists():
            marker_file.unlink()
    except Exception as e:
        _get_logger().warning("Failed to clear hard halt marker: %s", e)


# ---------------------------------------------------------------------------
# Session logging
# ---------------------------------------------------------------------------

def log_session_item(session_id: str, item: str):
    """Append a single line/chunk to the session_log table.

    Call this for every distinct piece of output: assistant text chunks,
    tool call descriptions, tool results, system messages, etc.
    Each gets its own row.
    """
    if not item or not item.strip():
        return

    with _lock:
        conn = _get_connection()
        try:
            # Truncate very long items to prevent unbounded growth per row
            truncated = item[:4096] + ("..." if len(item) > 4096 else "")
            conn.execute(
                "INSERT INTO session_log (session_id, item) VALUES (?, ?)",
                (session_id, truncated),
            )
            conn.commit()
        except Exception as e:
            _get_logger().warning("Session log write failed: %s", e)
        finally:
            conn.close()


def log_session_block(session_id: str, lines: list):
    """Log multiple lines at once - each becomes a separate row."""
    for line in lines:
        if line and line.strip():
            log_session_item(session_id, line)


def log_message(session_id: str, message: dict):
    """Log a single message dict from the conversation loop.

    Extracts content from assistant/tool/system messages and logs each
    line as a separate row in session_log.
    """
    role = message.get("role", "unknown")
    content = message.get("content", "")

    if not content:
        return

    # Log the role header
    log_session_item(session_id, f"[{role}]")

    # Split content into lines and log each
    for line in str(content).split("\n"):
        stripped = line.strip()
        if stripped:
            log_session_item(session_id, stripped)


def log_tool_call(session_id: str, tool_name: str, arguments: str):
    """Log a tool call being made."""
    log_session_item(session_id, f"[tool_call] {tool_name}")
    # Log first 500 chars of arguments to avoid massive rows
    if arguments and len(arguments) > 100:
        log_session_item(session_id, f"  args: {arguments[:500]}...")
    elif arguments:
        log_session_item(session_id, f"  args: {arguments}")


def log_tool_result(session_id: str, tool_name: str, result_preview: str):
    """Log a tool execution result."""
    log_session_item(session_id, f"[tool_result] {tool_name}")
    # Log first 500 chars of result
    if result_preview and len(result_preview) > 100:
        log_session_item(session_id, f"  result: {result_preview[:500]}...")
    elif result_preview:
        log_session_item(session_id, f"  result: {result_preview}")
