#!/usr/bin/env python3
"""
Migrate existing condensation_layers data into TotalRecall memories table.

Reads L1+ layers from state.db/condensation_layers and inserts them as
memories in totalrecall.db with appropriate tags and levels.

Usage:
    python scripts/migrate_condensation_to_totalrecall.py --dry-run   # Preview
    python scripts/migrate_condensation_to_totalrecall.py            # Execute

Only runs once — skips sessions already migrated (tracked via a migration
marker table in totalrecall.db).
"""

import argparse
import json
import logging
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Load .env for LLM access
lycus_home = Path(os.path.expanduser("~/.autolycus"))
project_env = Path(__file__).parent.parent / ".env"

sys.path.insert(0, str(Path(__file__).parent.parent))
from lycus_cli.env_loader import load_lycus_dotenv
load_lycus_dotenv(lycus_home=lycus_home, project_env=project_env)

logger = logging.getLogger("migration")

# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def get_state_conn() -> sqlite3.Connection:
    """Connect to the agent state database."""
    db_path = lycus_home / "state.db"
    if not db_path.exists():
        raise FileNotFoundError(f"State DB not found: {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def get_totalrecall_conn() -> sqlite3.Connection:
    """Connect to the TotalRecall database, initializing schema if needed."""
    tr_dir = lycus_home / "totalrecall"
    tr_dir.mkdir(parents=True, exist_ok=True)
    db_path = tr_dir / "totalrecall.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    # Initialize TotalRecall schema if not present
    try:
        from totalrecall.schema import SCHEMA as TR_SCHEMA
        conn.executescript(TR_SCHEMA)
        conn.commit()
    except Exception as e:
        logger.debug("Schema init note: %s", e)

    return conn


# ---------------------------------------------------------------------------
# Migration tracking
# ---------------------------------------------------------------------------

def init_migration_tracker(tr_conn: sqlite3.Connection) -> None:
    """Create migration tracking table if it doesn't exist."""
    tr_conn.execute("""
        CREATE TABLE IF NOT EXISTS migration_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_session_id TEXT NOT NULL,
            source_layer INTEGER NOT NULL,
            source_chunk_id INTEGER NOT NULL,
            target_memory_id INTEGER NOT NULL,
            migrated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
        )
    """)
    tr_conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_migration_session
            ON migration_log(source_session_id)
    """)
    tr_conn.commit()


def is_session_migrated(
    tr_conn: sqlite3.Connection, session_id: str
) -> bool:
    """Check if a session's condensation data was already migrated."""
    row = tr_conn.execute(
        "SELECT COUNT(*) as cnt FROM migration_log WHERE source_session_id = ?",
        (session_id,),
    ).fetchone()
    return row["cnt"] > 0


def log_migration(
    tr_conn: sqlite3.Connection,
    session_id: str,
    source_layer: int,
    source_chunk_id: int,
    target_memory_id: int,
) -> None:
    """Record a single migration entry."""
    tr_conn.execute(
        "INSERT INTO migration_log (source_session_id, source_layer, source_chunk_id, target_memory_id) "
        "VALUES (?, ?, ?, ?)",
        (session_id, source_layer, source_chunk_id, target_memory_id),
    )


# ---------------------------------------------------------------------------
# Tag extraction from condensed content (LLM-free)
# ---------------------------------------------------------------------------

def extract_tags_from_content(content: str, layer: int) -> List[str]:
    """Extract meaningful tags from condensed content without LLM.

    Strategy:
    - Look for section headers (markdown ##, **, bold text)
    - Look for file paths, commands, technical terms
    - Generate compound tags from adjacent keywords
    """
    if not content:
        return ["condensed-memory"]

    tags: List[str] = []
    tags.append(f"condensed-l{layer}")

    # Extract section headers (## Header, **Header**, etc.)
    header_matches = re.findall(r"(?:^|\n)\s*#{1,3}\s+(.+)", content)
    for h in header_matches:
        # Clean header text into tag format
        tag = re.sub(r"[^a-zA-Z0-9\s-]", "", h.strip()).lower().replace(" ", "-")
        if tag and len(tag) > 3:
            tags.append(tag)

    # Extract bold terms (**term**)
    bold_matches = re.findall(r"\*\*([^*]+)\*\*", content)
    for b in bold_matches:
        tag = re.sub(r"[^a-zA-Z0-9\s-]", "", b.strip()).lower().replace(" ", "-")
        if tag and len(tag) > 3:
            tags.append(tag)

    # Extract file paths
    path_matches = re.findall(r"(?:^|\s)(/[^\s'\",:]{5,}|~[^\s'\",:]{5,})", content)
    for p in path_matches:
        # Use directory name as tag
        dirname = os.path.basename(os.path.dirname(p))
        if dirname and len(dirname) > 2:
            tags.append(f"path-{dirname}")

    # Extract technical terms (snake_case, kebab-case, CamelCase)
    tech_matches = re.findall(r"\b([a-z][a-z0-9]{2,}(?:-[a-z0-9]+|_[a-z0-9]+)*)\b", content.lower())
    for t in tech_matches:
        if len(t) > 4:
            tags.append(t)

    # Deduplicate, limit to 20 tags
    seen: set[str] = set()
    unique_tags: List[str] = []
    for t in tags:
        if t not in seen and len(t) > 2:
            seen.add(t)
            unique_tags.append(t)
            if len(unique_tags) >= 20:
                break

    return unique_tags if unique_tags else ["condensed-memory"]


# ---------------------------------------------------------------------------
# Migration logic
# ---------------------------------------------------------------------------

def migrate(
    state_conn: sqlite3.Connection,
    tr_conn: sqlite3.Connection,
    dry_run: bool = False,
    session_ids: Optional[List[str]] = None,
    layers: Optional[List[int]] = None,
) -> Dict[str, int]:
    """Migrate condensation_layers data into TotalRecall memories.

    Returns dict with migration stats.
    """
    stats = {
        "sessions_scanned": 0,
        "sessions_migrated": 0,
        "memories_created": 0,
        "memories_skipped": 0,
        "errors": 0,
    }

    cursor = state_conn.cursor()

    # Build base query filters
    layer_filter = ""
    layer_params: tuple = ()
    if layers:
        placeholders = ",".join(["?" for _ in layers])
        layer_filter = f" AND cl.layer IN ({placeholders})"
        layer_params = tuple(layers)

    session_filter = ""
    session_params: tuple = ()
    if session_ids:
        placeholders = ",".join(["?" for _ in session_ids])
        session_filter = f" AND cl.session_id IN ({placeholders})"
        session_params = tuple(session_ids)

    # Get all L1+ chunks to migrate (skip L0 — it's raw data, not compressed)
    query = f"""
        SELECT DISTINCT cl.session_id
        FROM condensation_layers cl
        WHERE cl.layer >= 1
          {layer_filter}
          {session_filter}
        ORDER BY cl.session_id
    """
    rows = cursor.execute(query, layer_params + session_params).fetchall()
    stats["sessions_scanned"] = len(rows)

    if not rows:
        logger.info("No sessions with L1+ layers to migrate")
        return stats

    for session_row in rows:
        session_id = session_row["session_id"]

        # Skip already-migrated sessions
        if is_session_migrated(tr_conn, session_id):
            logger.debug("Session %s already migrated, skipping", session_id)
            stats["memories_skipped"] += 1
            continue

        # Get all L1+ chunks for this session
        chunks = cursor.execute(
            "SELECT id, layer, chunk_index, content, char_count, estimated_tokens "
            "FROM condensation_layers "
            "WHERE session_id = ? AND layer >= 1 "
            "ORDER BY layer ASC, chunk_index ASC",
            (session_id,),
        ).fetchall()

        if not chunks:
            continue

        for chunk in chunks:
            content = chunk["content"] or ""
            layer = chunk["layer"]

            # Extract tags from content
            tags = extract_tags_from_content(content, layer)

            # Insert into TotalRecall memories
            try:
                cur = tr_conn.execute(
                    "INSERT INTO memories (level, tags, information, source_chunk_ids) "
                    "VALUES (?, ?, ?, ?)",
                    (
                        layer,
                        json.dumps(tags),
                        content,
                        json.dumps([chunk["id"]]),
                    ),
                )
                memory_id = cur.lastrowid

                if not dry_run:
                    log_migration(
                        tr_conn,
                        session_id,
                        layer,
                        chunk["id"],
                        memory_id,
                    )

                stats["memories_created"] += 1
                logger.info(
                    "Migrated session %s L%d chunk %d -> memory %d (%d chars)",
                    session_id[:12],
                    layer,
                    chunk["chunk_index"],
                    memory_id,
                    len(content),
                )

            except Exception as e:
                stats["errors"] += 1
                logger.error(
                    "Failed to migrate session %s L%d chunk %d: %s",
                    session_id,
                    layer,
                    chunk["chunk_index"],
                    e,
                )

        stats["sessions_migrated"] += 1

    if not dry_run:
        tr_conn.commit()

    return stats


# ---------------------------------------------------------------------------
# Status display
# ---------------------------------------------------------------------------

def show_migration_status(state_conn: sqlite3.Connection, tr_conn: sqlite3.Connection) -> None:
    """Show current migration status."""
    # Source stats
    src_stats = state_conn.execute(
        "SELECT layer, COUNT(*) as cnt, SUM(char_count) as chars "
        "FROM condensation_layers WHERE layer >= 1 GROUP BY layer ORDER BY layer"
    ).fetchall()

    # Target stats
    tgt_stats = tr_conn.execute(
        "SELECT level, COUNT(*) as cnt, SUM(LENGTH(information)) as chars "
        "FROM memories GROUP BY level ORDER BY level"
    ).fetchall()

    # Migration progress
    migrated = tr_conn.execute(
        "SELECT COUNT(DISTINCT source_session_id) as cnt FROM migration_log"
    ).fetchone()["cnt"]

    total_l1_sessions = state_conn.execute(
        "SELECT COUNT(DISTINCT session_id) as cnt "
        "FROM condensation_layers WHERE layer >= 1"
    ).fetchone()["cnt"]

    print("\n=== Migration Status ===")
    print(f"\nSource (condensation_layers L1+):")
    for r in src_stats:
        print(f"  L{r['layer']}: {r['cnt']} chunks, {r['chars']:,} chars")

    print(f"\nTarget (totalrecall memories):")
    for r in tgt_stats:
        print(f"  L{r['level']}: {r['cnt']} memories, {r['chars']:,} chars")

    print(f"\nProgress: {migrated}/{total_l1_sessions} sessions migrated "
          f"({migrated / max(total_l1_sessions, 1) * 100:.1f}%)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Migrate condensation_layers to TotalRecall")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--status", action="store_true", help="Show migration status")
    parser.add_argument("--sessions", type=str, help="Comma-separated session IDs to migrate")
    parser.add_argument("--layers", type=str, help="Comma-separated layer numbers to migrate")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    state_conn = get_state_conn()
    tr_conn = get_totalrecall_conn()

    try:
        # Always init migration tracker first (creates tracking table)
        init_migration_tracker(tr_conn)

        if args.status:
            show_migration_status(state_conn, tr_conn)
            return

        session_ids = None
        if args.sessions:
            session_ids = [s.strip() for s in args.sessions.split(",")]

        layers = None
        if args.layers:
            layers = [int(l.strip()) for l in args.layers.split(",")]

        mode = "DRY RUN" if args.dry_run else "LIVE"
        print(f"\n=== Migration ({mode}) ===")

        stats = migrate(state_conn, tr_conn, dry_run=args.dry_run,
                       session_ids=session_ids, layers=layers)

        print(f"\nSessions scanned:    {stats['sessions_scanned']}")
        print(f"Sessions migrated:   {stats['sessions_migrated']}")
        print(f"Memories created:    {stats['memories_created']}")
        print(f"Memories skipped:    {stats['memories_skipped']}")
        print(f"Errors:              {stats['errors']}")

        if args.dry_run:
            print("\nNo data was written. Run without --dry-run to execute.")
        elif stats["errors"] > 0:
            print(f"\n⚠  Migration completed with {stats['errors']} errors. Check logs.")
        else:
            print("\n✅ Migration completed successfully.")

    finally:
        state_conn.close()
        tr_conn.close()


if __name__ == "__main__":
    main()
