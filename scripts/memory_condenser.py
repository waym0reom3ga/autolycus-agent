#!/usr/bin/env python3
"""
Memory Condensation Engine (unified with TotalRecall).

Delegates to TotalRecall for status and search. The legacy condensation_layers
table is kept for backward compatibility. Run migrate_condensation_to_totalrecall.py
to migrate existing data.

Usage:
    python scripts/memory_condenser.py --status   # Show TotalRecall status
    python scripts/memory_condenser.py --search Q # Search condensed memory
"""

import argparse
import logging
import os
import sqlite3
import sys
from pathlib import Path

lycus_home = Path(os.path.expanduser("~/.autolycus"))
project_env = Path(__file__).parent.parent / ".env"
sys.path.insert(0, str(Path(__file__).parent.parent))
from lycus_cli.env_loader import load_lycus_dotenv
load_lycus_dotenv(lycus_home=lycus_home, project_env=project_env)

logger = logging.getLogger("memory_condenser")


def get_connection():
    """Get a connection to the state database."""
    conn = sqlite3.connect(str(lycus_home / "state.db"))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def show_status(conn):
    """Show TotalRecall memory status."""
    try:
        from totalrecall.core import TotalRecall
        tr_dir = lycus_home / "totalrecall"
        tr = TotalRecall(db_dir=str(tr_dir))
        stats = tr.status()
        memories_by_level = stats.get("memories_by_level", {})
        total_memories = stats.get("total_memories", 0)
        llm_failures = stats.get("llm_failure_count", 0)
        last_error = stats.get("last_llm_error", "")
        print("\nTotalRecall Memory Status:")
        print("-" * 60)
        if total_memories == 0:
            print("  No compressed memories yet.")
        else:
            for level in sorted(memories_by_level.keys()):
                count = memories_by_level[level]
                print(f"  L{level}: {count} memories")
            print(f"  Total: {total_memories} compressed memories")
        print(f"  LLM backend health: {llm_failures} consecutive failures")
        if last_error:
            print(f"  Last LLM error: {last_error}")
        tr.close()
    except Exception as e:
        logger.warning("TotalRecall status unavailable: %s", e)
        print("TotalRecall not available.")


def search_condensed(conn, query):
    """Search condensed memory using TotalRecall."""
    try:
        from totalrecall.core import TotalRecall
        from plugins.memory.totalrecall import _extract_tags
        tr_dir = lycus_home / "totalrecall"
        tr = TotalRecall(db_dir=str(tr_dir))
        tags = _extract_tags(query)
        result = tr.recall(tags, max_tokens=200_000, query_text=query)
        tr.close()
        if result and result.strip():
            print(f"\nSearch results for '{query}':\n")
            print(result[:2000])
            return
    except Exception as e:
        logger.debug("TotalRecall search unavailable: %s", e)
    print(f"No results for '{query}'")


def main():
    parser = argparse.ArgumentParser(
        description="Memory Condensation Engine (unified with TotalRecall)",
        epilog="Delegates to TotalRecall. Run migrate_condensation_to_totalrecall.py to migrate existing data.",
    )
    parser.add_argument("--status", action="store_true", help="Show condensation status")
    parser.add_argument("--search", type=str, help="Search condensed memory")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    conn = get_connection()
    try:
        if args.status:
            show_status(conn)
        elif args.search:
            search_condensed(conn, args.search)
        else:
            print("Usage: python scripts/memory_condenser.py --status|--search QUERY")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
