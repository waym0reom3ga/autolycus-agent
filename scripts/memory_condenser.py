#!/usr/bin/env python3
"""
Memory Condensation Engine - Multi-layer progressive distillation.

Builds a pyramid of compressed knowledge from raw session messages:
  Layer 0: Raw message chunks (under 32k chars each)
  Layer 1: Semantic summaries of layer 0 chunks
  Layer 2: High-level abstractions of layer 1 summaries
  ... and so on, opportunistically

Each layer preserves information at a different granularity. Higher layers
give broad context quickly; lower layers give detail when you drill down.

Usage:
    python scripts/memory_condenser.py              # Run one cycle
    python scripts/memory_condenser.py --status      # Show condensation status
    python scripts/memory_condenser.py --layer 1     # Condense to specific layer
"""

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import List, Optional, Tuple

# Load .env for LLM access
lycus_home = Path(os.path.expanduser('~/.autolycus'))
project_env = Path(__file__).parent.parent / ".env"

sys.path.insert(0, str(Path(__file__).parent.parent))
from lycus_cli.env_loader import load_lycus_dotenv
load_lycus_dotenv(lycus_home=lycus_home, project_env=project_env)

logger = logging.getLogger('memory_condenser')

# Constants
LAYER_0_MAX_CHARS = 32768  # Max chars per raw chunk
CONDENSE_TARGET_TOKENS = 500  # Target tokens for condensed output
DB_PATH = lycus_home / "state.db"
WEEK_SECONDS = 7 * 24 * 3600  # One week in seconds - max age for fresh chunks


def get_connection() -> sqlite3.Connection:
    """Get a connection to the state database."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_schema(conn: sqlite3.Connection):
    """Create condensation tables if they don't exist."""
    cursor = conn.cursor()

    # Add session_timestamp column for time-based pruning
    try:
        cursor.execute("""
            ALTER TABLE condensation_layers 
            ADD COLUMN session_ended_at REAL DEFAULT NULL
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_cond_session_ended ON condensation_layers(session_ended_at)")
    except sqlite3.OperationalError:
        pass  # Column already exists

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS condensation_layers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            layer INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            source_ids TEXT,           -- JSON array of source message/chunk IDs
            char_count INTEGER NOT NULL DEFAULT 0,
            estimated_tokens INTEGER NOT NULL DEFAULT 0,
            condensation_prompt TEXT,   -- The prompt used to generate this chunk
            created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_cond_session_layer
            ON condensation_layers(session_id, layer);

        CREATE INDEX IF NOT EXISTS idx_cond_layer_chunk
            ON condensation_layers(layer, chunk_index);

        -- FTS5 for searching across all layers
        CREATE VIRTUAL TABLE IF NOT EXISTS condensation_fts USING fts5(
            content,
            content='condensation_layers',
            content_rowid='rowid'
        );

        -- Trigger to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS cond_insert AFTER INSERT ON condensation_layers
        BEGIN
            INSERT INTO condensation_fts(rowid, content)
            VALUES (new.id, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS cond_update AFTER UPDATE OF content ON condensation_layers
        BEGIN
            DELETE FROM condensation_fts WHERE rowid = old.id;
            INSERT INTO condensation_fts(rowid, content)
            VALUES (new.id, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS cond_delete AFTER DELETE ON condensation_layers
        BEGIN
            DELETE FROM condensation_fts WHERE rowid = old.id;
        END;
    """)

    conn.commit()


def populate_layer_0(conn: sqlite3.Connection, session_ids: Optional[List[str]] = None) -> int:
    """
    Populate layer 0 with raw message chunks from sessions ended within the last week.

    Groups consecutive user+assistant messages within a session into chunks
    under LAYER_0_MAX_CHARS each. Skips tool output and system messages.

    Time-based pruning: only processes sessions that ended within WEEK_SECONDS.
    Older sessions fade away naturally - not re-condensed, just forgotten in the DB.

    Returns number of new chunks created.
    """
    cursor = conn.cursor()
    new_count = 0
    now = time.time()
    week_ago = now - WEEK_SECONDS

    if session_ids:
        placeholders = ','.join(['?' for _ in session_ids])
        where_clause = f"WHERE s.id IN ({placeholders}) AND s.ended_at IS NOT NULL AND s.ended_at >= ?"
        params = tuple(session_ids) + (week_ago,)
    else:
        where_clause = "WHERE s.ended_at IS NOT NULL AND s.ended_at >= ?"
        params = (week_ago,)

    cursor.execute(f"""
        SELECT DISTINCT s.id, s.ended_at FROM sessions s {where_clause} ORDER BY s.started_at
    """, params)

    for row in cursor.fetchall():
        session_id = row['id']
        session_ended_at = row['ended_at']

        # Check if layer 0 already exists for this session
        cursor.execute(
            "SELECT COUNT(*) as cnt FROM condensation_layers WHERE session_id=? AND layer=0",
            (session_id,)
        )
        existing = cursor.fetchone()['cnt']
        if existing > 0:
            continue

        # Get messages in order, only user+assistant roles
        cursor.execute("""
            SELECT id, role, content FROM messages
            WHERE session_id=? AND active=1 AND role IN ('user', 'assistant')
              AND LENGTH(COALESCE(content, '')) > 0
            ORDER BY timestamp ASC
        """, (session_id,))

        messages = cursor.fetchall()
        if not messages:
            continue

        # Group into chunks under max chars
        chunk_messages = []
        chunk_chars = 0
        chunk_index = 0

        for msg in messages:
            msg_content = msg['content'] or ''
            msg_len = len(msg_content)

            if chunk_chars + msg_len > LAYER_0_MAX_CHARS and chunk_messages:
                # Flush current chunk
                _insert_chunk(conn, session_id, 0, chunk_index, chunk_messages, session_ended_at)
                new_count += 1
                chunk_messages = []
                chunk_chars = 0
                chunk_index += 1

            chunk_messages.append({
                'id': msg['id'],
                'role': msg['role'],
                'content': msg_content
            })
            chunk_chars += msg_len

        # Flush remaining
        if chunk_messages:
            _insert_chunk(conn, session_id, 0, chunk_index, chunk_messages, session_ended_at)
            new_count += 1

    conn.commit()
    return new_count


def _insert_chunk(conn: sqlite3.Connection, session_id: str, layer: int,
                  chunk_index: int, messages: List[dict], session_ended_at: Optional[float] = None):
    """Insert a single condensation chunk."""
    cursor = conn.cursor()

    # Build content from messages
    content_parts = []
    source_ids = []
    for m in messages:
        content_parts.append(f"[{m['role'].upper()}]\n{m['content']}")
        source_ids.append(str(m['id']))

    content = "\n\n".join(content_parts)
    char_count = len(content)
    estimated_tokens = char_count // 4  # rough estimate

    cursor.execute("""
        INSERT INTO condensation_layers (session_id, layer, chunk_index, content,
                                         source_ids, char_count, estimated_tokens, session_ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (session_id, layer, chunk_index, content,
          json.dumps(source_ids), char_count, estimated_tokens, session_ended_at))


def get_layer_summary(conn: sqlite3.Connection, layer: int, session_id: str) -> dict:
    """Get summary stats for a specific layer and session."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*) as chunk_count,
               SUM(char_count) as total_chars,
               SUM(estimated_tokens) as total_tokens
        FROM condensation_layers
        WHERE session_id=? AND layer=?
    """, (session_id, layer))
    return dict(cursor.fetchone())


def condense_layer(conn: sqlite3.Connection, source_layer: int, target_layer: int,
                   session_ids: Optional[List[str]] = None) -> Tuple[int, int]:
    """
    Condense chunks from source_layer into target_layer summaries.

    Takes all chunks at source_layer for completed sessions and condenses them
    into higher-level summaries at target_layer.

    Returns (sessions_processed, chunks_created).
    """
    cursor = conn.cursor()

    # Find sessions that have source_layer but not target_layer
    if session_ids:
        placeholders = ','.join(['?' for _ in session_ids])
        where_in = f"AND s.id IN ({placeholders})"
        params_base = tuple(session_ids)
    else:
        where_in = ""
        params_base = ()

    query = f"""
        SELECT DISTINCT s.id FROM sessions s
        WHERE s.ended_at IS NOT NULL {where_in}
          AND EXISTS (SELECT 1 FROM condensation_layers c
                      WHERE c.session_id = s.id AND c.layer = ?)
          AND NOT EXISTS (SELECT 1 FROM condensation_layers c2
                          WHERE c2.session_id = s.id AND c2.layer = ?)
        ORDER BY s.started_at DESC
    """

    cursor.execute(query, params_base + (source_layer, target_layer))
    sessions_to_condense = [row['id'] for row in cursor.fetchall()]

    if not sessions_to_condense:
        return 0, 0

    total_chunks = 0

    for session_id in sessions_to_condense:
        # Get all chunks at source layer
        cursor.execute("""
            SELECT id, content FROM condensation_layers
            WHERE session_id=? AND layer=?
            ORDER BY chunk_index ASC
        """, (session_id, source_layer))

        source_chunks = [dict(row) for row in cursor.fetchall()]
        if not source_chunks:
            continue

        # Group source chunks into batches for condensation
        # Each batch should fit within model context comfortably
        batch_size = _calculate_batch_size(source_chunks, conn)
        batches = [source_chunks[i:i+batch_size]
                   for i in range(0, len(source_chunks), batch_size)]

        for batch_idx, batch in enumerate(batches):
            condensed = _condense_batch(batch, source_layer, target_layer)
            if condensed:
                cursor.execute("""
                    INSERT INTO condensation_layers (session_id, layer, chunk_index,
                                                     content, source_ids, char_count,
                                                     estimated_tokens, condensation_prompt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (session_id, target_layer, batch_idx, condensed['content'],
                      json.dumps([c['id'] for c in batch]),
                      len(condensed['content']),
                      condensed.get('tokens', len(condensed['content']) // 4),
                      condensed.get('prompt', '')))
                total_chunks += 1

    conn.commit()
    return len(sessions_to_condense), total_chunks


def _calculate_batch_size(chunks: List[dict], conn: sqlite3.Connection) -> int:
    """Calculate how many source chunks to batch per condensation call."""
    if not chunks:
        return 1

    # Estimate available context (model max minus prompt overhead)
    available_context = 260000 - 4000  # conservative estimate for our model
    avg_chunk_size = sum(len(c['content']) for c in chunks) // len(chunks)

    if avg_chunk_size == 0:
        return 10

    batch_size = min(available_context // (avg_chunk_size + 500), len(chunks))
    return max(1, batch_size)


def _condense_batch(chunks: List[dict], source_layer: int, target_layer: int) -> Optional[dict]:
    """Condense a batch of chunks using the LLM."""
    # Build the condensation prompt
    chunk_contents = []
    for i, c in enumerate(chunks):
        content = c['content'][:LAYER_0_MAX_CHARS]  # safety cap
        chunk_contents.append(f"--- Chunk {i+1} ---\n{content}")

    source_text = "\n\n".join(chunk_contents)

    prompt = f"""You are a knowledge distillation engine. Condense the following session chunks into a concise summary.

Source layer: {source_layer}
Target layer: {target_layer}
Number of source chunks: {len(chunks)}

INSTRUCTIONS:
- Preserve key facts, decisions, code changes, and outcomes
- Remove conversational filler, greetings, and redundant explanations
- Keep technical details (file paths, commands, error messages) that would be useful for recall
- Target approximately {CONDENSE_TARGET_TOKENS} tokens of output
- Use clear section headers if the content spans multiple topics

SOURCE CHUNKS:
{source_text}

CONDENSED SUMMARY:"""

    # Call the LLM via direct HTTP (avoids openai dependency)
    try:
        import urllib.request
        import urllib.error
        
        # Load provider config from .env or config.yaml
        base_url = os.environ.get('OPENAI_BASE_URL', 'http://192.168.2.22:1234/v1')
        api_key = os.environ.get('OPENAI_API_KEY', 'lycus-local')
        model = os.environ.get('LYCUS_MODEL', 'unsloth/qwen3.6-27b-mtp')
        
        # Ensure URL ends with /chat/completions
        if not base_url.endswith('/v1'):
            base_url = base_url.rstrip('/') + '/v1'
        url = f"{base_url}/chat/completions"
        
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": CONDENSE_TARGET_TOKENS * 2,
            "temperature": 0.3,
        }
        
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=300) as response:
            result = json.loads(response.read().decode('utf-8'))
            
        if result and 'choices' in result and len(result['choices']) > 0:
            msg = result['choices'][0]['message']
            # Some models put output in reasoning_content instead of content
            content = msg.get('content', '') or msg.get('reasoning_content', '')
            return {
                'content': content,
                'tokens': CONDENSE_TARGET_TOKENS,
                'prompt': prompt[:1000]  # store truncated prompt for reference
            }
    except Exception as e:
        logger.warning(f"Condensation LLM call failed: {e}")

    return None


def show_status(conn: sqlite3.Connection):
    """Display condensation status across all layers with age info."""
    cursor = conn.cursor()
    now = time.time()
    week_ago = now - WEEK_SECONDS

    # Overall stats
    cursor.execute("""
        SELECT layer, COUNT(*) as chunk_count,
               SUM(char_count) as total_chars,
               SUM(estimated_tokens) as estimated_tokens,
               COUNT(DISTINCT session_id) as sessions_covered,
               MIN(session_ended_at) as oldest_session,
               MAX(session_ended_at) as newest_session
        FROM condensation_layers
        GROUP BY layer
        ORDER BY layer ASC
    """)

    rows = cursor.fetchall()
    if not rows:
        print("No condensation layers exist yet.")
        return

    print("\nCondensation Status:")
    print("-" * 80)
    for row in rows:
        oldest_age = (now - row['oldest_session']) / (24 * 3600) if row['oldest_session'] else 0
        newest_age = (now - row['newest_session']) / (24 * 3600) if row['newest_session'] else 0
        print(f"Layer {row['layer']}: {row['chunk_count']} chunks, "
              f"{row['total_chars']:>10,} chars, "
              f"~{row['estimated_tokens']:>8,} tokens, "
              f"{row['sessions_covered']} sessions")
        print(f"  Age range: {newest_age:.1f} - {oldest_age:.1f} days old")

    # Sessions without any condensation
    cursor.execute("""
        SELECT COUNT(*) as total FROM sessions WHERE ended_at IS NOT NULL
    """)
    total_completed = cursor.fetchone()['total']

    cursor.execute("""
        SELECT COUNT(DISTINCT session_id) as condensed FROM condensation_layers
    """)
    has_condensed = cursor.fetchone()['condensed']

    # Time-based pruning info
    cursor.execute("""
        SELECT COUNT(*) as recent FROM sessions 
        WHERE ended_at IS NOT NULL AND ended_at >= ?
    """, (week_ago,))
    recent_sessions = cursor.fetchone()['recent']

    print(f"\nCompleted sessions: {total_completed}")
    print(f"Sessions with condensation: {has_condensed}")
    print(f"Sessions pending: {total_completed - has_condensed}")
    print(f"\nTime-based pruning (last {WEEK_SECONDS // (24*3600)} days):")
    print(f"  Recent sessions eligible for L0: {recent_sessions}")
    print(f"  Older sessions (faded from active processing): {total_completed - recent_sessions}")


def search_condensed(conn: sqlite3.Connection, query: str) -> List[dict]:
    """Search across all condensation layers using FTS."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT cl.id, cl.session_id, cl.layer, cl.chunk_index,
               cl.content, s.title as session_title, s.started_at
        FROM condensation_layers cl
        JOIN sessions s ON s.id = cl.session_id
        WHERE rowid IN (
            SELECT rowid FROM condensation_fts
            WHERE condensation_fts MATCH ?
        )
        ORDER BY cl.layer ASC, s.started_at DESC
    """, (query,))

    return [dict(row) for row in cursor.fetchall()]


def run_cycle(target_layer: Optional[int] = None):
    """Run one condensation cycle."""
    conn = get_connection()
    try:
        init_schema(conn)

        # Step 1: Populate layer 0 (raw chunks)
        l0_count = populate_layer_0(conn)
        if l0_count > 0:
            print(f"Created {l0_count} new layer-0 chunks")

        # Step 2: Condense upward
        current_layer = 0
        while True:
            if target_layer is not None and current_layer >= target_layer:
                break

            next_layer = current_layer + 1
            sessions_processed, chunks_created = condense_layer(
                conn, current_layer, next_layer
            )

            if chunks_created == 0:
                print(f"No new layer-{next_layer} chunks to create")
                break

            print(f"Condensed {sessions_processed} sessions from layer "
                  f"{current_layer} -> {next_layer}: {chunks_created} chunks created")
            current_layer = next_layer

    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description='Memory Condensation Engine')
    parser.add_argument('--status', action='store_true', help='Show condensation status')
    parser.add_argument('--layer', type=int, help='Target layer to condense up to')
    parser.add_argument('--search', type=str, help='Search condensed memory')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)

    conn = get_connection()
    try:
        init_schema(conn)

        if args.status:
            show_status(conn)
        elif args.search:
            results = search_condensed(conn, args.search)
            print(f"\nFound {len(results)} matches for '{args.search}':\n")
            for r in results:
                preview = r['content'][:200].replace('\n', ' ')
                print(f"[Layer {r['layer']}] Session: {r.get('session_title', 'N/A')}")
                print(f"  {preview}...\n")
        else:
            run_cycle(target_layer=args.layer)

    finally:
        conn.close()


if __name__ == '__main__':
    main()
