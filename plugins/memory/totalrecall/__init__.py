"""TotalRecall memory plugin — recursive memory compression with LLM distillation.

Registers as a MemoryProvider plugin, giving the agent persistent recall via
hierarchical memory compression: raw conversation turns are ingested as commands,
chunked, compressed into L1 memories by an LLM, and then recursively compressed
into higher-level summaries (L2, L3, …). Recall uses tag-based retrieval with
decay scoring.

Config in $AUTOLYCUS_HOME/config.yaml (profile-scoped):
  plugins:
    totalrecall:
      db_dir: $AUTOLYCUS_HOME/totalrecall   # omit to use the default
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lazy TotalRecall import — the package is installed separately
# ---------------------------------------------------------------------------

_TotalRecall: Any = None
_TotalRecall_import_error: Optional[str] = None

try:
    from totalrecall.core import TotalRecall as _TotalRecall  # noqa: F811
except ImportError as exc:
    _TotalRecall_import_error = str(exc)


# ---------------------------------------------------------------------------
# LLM backend wrapper — bridges Lycus auxiliary_client to TotalRecall
# ---------------------------------------------------------------------------

def _lycus_llm_backend(messages, temperature=None, max_tokens=None):
    """Callable that TotalRecall invokes for compression/distillation."""
    from agent.auxiliary_client import call_llm
    kwargs = {
        "task": "memory_compression",
        "messages": messages,
        "temperature": temperature or 0.1,
    }
    if max_tokens is not None:
        kwargs["max_tokens"] = int(max_tokens)
    return call_llm(**kwargs)


# ---------------------------------------------------------------------------
# Tag extraction helper
# ---------------------------------------------------------------------------

def _extract_tags(text: str) -> List[str]:
    """Pull meaningful tags from query text by splitting on spaces/punctuation."""
    if not text:
        return []
    # Split on whitespace and punctuation, keep words >= 2 chars
    tokens = re.split(r'[\s\W_]+', text.lower())
    return [t for t in tokens if len(t) >= 2]


# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------

TOTALRECALL_SEARCH_SCHEMA = {
    "name": "totalrecall_search",
    "description": (
        "Search TotalRecall memory by query text. Extracts tags from the query, "
        "retrieves relevant compressed memories ranked by relevance and decay score. "
        "Use this to recall past conversations, decisions, preferences, and facts."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Free-text search query. Tags are extracted automatically.",
            },
            "max_tokens": {
                "type": "integer",
                "description": "Maximum token budget for results (default: 200000).",
            },
        },
        "required": ["query"],
    },
}

TOTALRECALL_STATUS_SCHEMA = {
    "name": "totalrecall_status",
    "description": (
        "Show TotalRecall memory statistics: total commands ingested, unassigned commands, "
        "pending chunks, memories by compression level, and overall memory count."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

TOTALRECALL_COMPRESS_SCHEMA = {
    "name": "totalrecall_compress",
    "description": (
        "Trigger a compression cycle: assign unchunked commands into a new chunk, "
        "then compress that chunk into L1 memories using the LLM. Use this to actively "
        "distill recent conversation history into durable compressed memories."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}


# ---------------------------------------------------------------------------
# MemoryProvider implementation
# ---------------------------------------------------------------------------

class TotalRecallMemoryProvider(MemoryProvider):
    """TotalRecall — recursive memory compression with LLM distillation."""

    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._tr: Any = None
        self._session_id: str = ""

    @property
    def name(self) -> str:
        return "totalrecall"

    # -- Availability -------------------------------------------------------

    def is_available(self) -> bool:
        """Return True if TotalRecall package is installed."""
        if _TotalRecall_import_error:
            logger.warning("TotalRecall not installed: %s", _TotalRecall_import_error)
            return False
        return True

    # -- Initialization -----------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        """Create TotalRecall instance and connect to the database."""
        self._session_id = session_id

        # Resolve db_dir from kwargs or config
        lycus_home = kwargs.get("lycus_home", "")
        if not lycus_home:
            try:
                from lycus_constants import get_lycus_home
                lycus_home = str(get_lycus_home())
            except Exception:
                lycus_home = os.path.expanduser("~/.autolycus")

        db_dir = self._config.get("db_dir", os.path.join(lycus_home, "totalrecall"))

        # Expand environment variables and user home in path
        if isinstance(db_dir, str):
            db_dir = db_dir.replace("$AUTOLYCUS_HOME", lycus_home)
            db_dir = db_dir.replace("${AUTOLYCUS_HOME}", lycus_home)
            db_dir = os.path.expanduser(db_dir)

        # Ensure directory exists
        os.makedirs(db_dir, exist_ok=True)

        try:
            self._tr = _TotalRecall(
                db_dir=db_dir,
                llm_backend=_lycus_llm_backend,
            )
            logger.info("TotalRecall initialized at %s", db_dir)
        except Exception as exc:
            logger.error("Failed to initialize TotalRecall: %s", exc)
            self._tr = None

    # -- System prompt block ------------------------------------------------

    def system_prompt_block(self) -> str:
        """Return status block showing memory counts by level."""
        if not self._tr:
            return ""
        try:
            stats = self._tr.status()
        except Exception as exc:
            logger.debug("TotalRecall status failed: %s", exc)
            return ""

        memories_by_level = stats.get("memories_by_level", {})
        total_memories = stats.get("total_memories", 0)

        if total_memories == 0:
            return (
                "# TotalRecall Memory\n"
                "Active. No compressed memories yet — conversations will be ingested and compressed at session end.\n"
                "Use totalrecall_compress to actively distill recent turns into durable memories."
            )

        level_lines = []
        for level in sorted(memories_by_level.keys()):
            count = memories_by_level[level]
            level_lines.append(f"L{level}: {count}")
        levels_str = ", ".join(level_lines)

        return (
            f"# TotalRecall Memory\n"
            f"Active. {total_memories} compressed memories ({levels_str}).\n"
            f"Use totalrecall_search to recall past context, totalrecall_status for stats, "
            f"totalrecall_compress to distill recent turns."
        )

    # -- Prefetch -----------------------------------------------------------

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Recall relevant memories based on the incoming query."""
        if not self._tr or not query:
            return ""
        try:
            tags = _extract_tags(query)
            if not tags:
                return ""
            result = self._tr.recall(tags, max_tokens=200_000)
            if not result or not result.strip():
                return ""
            return f"## TotalRecall Memory\n{result}"
        except Exception as exc:
            logger.debug("TotalRecall prefetch failed: %s", exc)
            return ""

    # -- Turn sync ----------------------------------------------------------

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "", messages: Optional[List[Dict[str, Any]]] = None) -> None:
        """Ingest a completed turn into TotalRecall."""
        if not self._tr or not user_content:
            return
        try:
            self._tr.ingest(self._session_id, user_content, assistant_content)
        except Exception as exc:
            logger.debug("TotalRecall ingest failed: %s", exc)

    # -- Tool schemas -------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [TOTALRECALL_SEARCH_SCHEMA, TOTALRECALL_STATUS_SCHEMA, TOTALRECALL_COMPRESS_SCHEMA]

    # -- Tool call dispatch -------------------------------------------------

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if tool_name == "totalrecall_search":
            return self._handle_search(args)
        elif tool_name == "totalrecall_status":
            return self._handle_status()
        elif tool_name == "totalrecall_compress":
            return self._handle_compress()
        return tool_error(f"Unknown TotalRecall tool: {tool_name}")

    # -- Session end --------------------------------------------------------

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Run compression cycles at session boundary."""
        if not self._tr:
            logger.warning("TotalRecall not initialized, skipping session-end compression")
            return

        try:
            # Phase 1: Assign and compress all remaining unchunked commands
            compressed_chunks = 0
            while True:
                chunk_number = self._tr.assign_chunk()
                if chunk_number is None:
                    break
                new_memory_ids = self._tr.compress_chunk(chunk_number)
                if new_memory_ids:
                    compressed_chunks += 1
                    logger.info("Compressed chunk %d -> %d L1 memories", chunk_number, len(new_memory_ids))

            # Phase 2: Recursive compression of accumulated L1 memories
            stats = self._tr.status()
            l1_count = stats.get("memories_by_level", {}).get(1, 0)
            if l1_count > 5:
                logger.info("Triggering recursive compression for %d L1 memories", l1_count)
                # Collect all L1 memory IDs and compress them into higher levels
                self._recursive_compress_l1()

        except Exception as exc:
            logger.error("TotalRecall session-end compression failed: %s", exc)

    def _recursive_compress_l1(self) -> None:
        """Compress accumulated L1 memories into higher-level summaries."""
        try:
            # Fetch all L1 memory IDs from the database
            rows = self._tr.conn.execute(
                "SELECT id FROM memories WHERE level = 1 ORDER BY created_at DESC"
            ).fetchall()
            l1_ids = [r["id"] for r in rows]

            if len(l1_ids) < 3:
                logger.debug("Only %d L1 memories — skipping recursive compression", len(l1_ids))
                return

            # Compress in batches of 20 to stay within context limits
            batch_size = 20
            for i in range(0, len(l1_ids), batch_size):
                batch = l1_ids[i:i + batch_size]
                new_ids = self._tr.compress_memories(batch)
                if new_ids:
                    logger.info("Recursive compression: %d L1 -> %d higher-level memories",
                                len(batch), len(new_ids))
        except Exception as exc:
            logger.debug("Recursive L1 compression failed: %s", exc)

    # -- Shutdown -----------------------------------------------------------

    def shutdown(self) -> None:
        """Close TotalRecall connection."""
        if self._tr:
            try:
                self._tr.close()
            except Exception as exc:
                logger.debug("TotalRecall close failed: %s", exc)
            finally:
                self._tr = None

    # -- Tool handler implementations ---------------------------------------

    def _handle_search(self, args: dict) -> str:
        """Handle totalrecall_search tool call."""
        if not self._tr:
            return tool_error("TotalRecall not initialized")
        try:
            query = args.get("query", "")
            max_tokens = int(args.get("max_tokens", 200_000))

            tags = _extract_tags(query)
            if not tags:
                return json.dumps({"results": [], "message": "No meaningful tags extracted from query"})

            result = self._tr.recall(tags, max_tokens=max_tokens)
            return json.dumps({
                "query": query,
                "tags": tags,
                "context": result if result else "",
            })
        except KeyError as exc:
            return tool_error(f"Missing required argument: {exc}")
        except Exception as exc:
            return tool_error(str(exc))

    def _handle_status(self) -> str:
        """Handle totalrecall_status tool call."""
        if not self._tr:
            return tool_error("TotalRecall not initialized")
        try:
            stats = self._tr.status()
            return json.dumps(stats, default=str)
        except Exception as exc:
            return tool_error(str(exc))

    def _handle_compress(self) -> str:
        """Handle totalrecall_compress tool call."""
        if not self._tr:
            return tool_error("TotalRecall not initialized")
        try:
            # Assign the next chunk of unchunked commands
            chunk_number = self._tr.assign_chunk()
            if chunk_number is None:
                return json.dumps({
                    "status": "no_unassigned_commands",
                    "message": "No unassigned commands to compress. All ingested turns are already chunked.",
                })

            # Compress the assigned chunk into L1 memories
            new_memory_ids = self._tr.compress_chunk(chunk_number)
            return json.dumps({
                "status": "compressed",
                "chunk_number": chunk_number,
                "new_memory_count": len(new_memory_ids),
                "memory_ids": new_memory_ids,
            })
        except Exception as exc:
            return tool_error(str(exc))


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Register the TotalRecall memory provider with the plugin system."""
    config = {}
    try:
        from lycus_cli.config import cfg_get
        from lycus_constants import get_lycus_home
        config_path = get_lycus_home() / "config.yaml"
        if config_path.exists():
            import yaml  # noqa: TID251
            with open(config_path, encoding="utf-8-sig") as f:
                all_config = yaml.safe_load(f) or {}
            config = cfg_get(all_config, "plugins", "totalrecall", default={}) or {}
    except Exception:
        pass

    provider = TotalRecallMemoryProvider(config=config)
    ctx.register_memory_provider(provider)
