"""TotalRecall memory plugin — recursive memory compression with LLM distillation.

Registers as a MemoryProvider plugin, giving the agent persistent recall via
hierarchical memory compression: raw conversation turns are ingested as commands,
chunked, compressed into L1 memories by an LLM, and then recursively compressed
into higher-level summaries (L2, L3, …). Recall uses tag-based retrieval with
decay scoring.

Also registers the `memory_compression` auxiliary task so Lycus routes LLM calls
through the configured provider instead of failing silently.

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
    from totalrecall.core import CompressionError  # noqa: F401
except ImportError as exc:
    _TotalRecall_import_error = str(exc)


# ---------------------------------------------------------------------------
# LLM backend wrapper — bridges Lycus auxiliary_client to TotalRecall
# ---------------------------------------------------------------------------

def _lycus_llm_backend(messages, temperature=None, max_tokens=None):
    """Callable that TotalRecall invokes for compression/distillation.

    Routes through Lycus auxiliary_client with task='memory_compression'.
    Returns an OpenAI-style response object with .choices[0].message.content.
    Falls back to the main chat provider if memory_compression is not configured.
    """
    from agent.auxiliary_client import call_llm

    # Try memory_compression task first (registered by this plugin)
    try:
        kwargs = {
            "task": "memory_compression",
            "messages": messages,
            "temperature": temperature or 0.1,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = int(max_tokens)
        return call_llm(**kwargs)
    except Exception as primary_err:
        logger.warning("TotalRecall memory_compression task failed (%s), trying main provider", primary_err)

    # Fallback: use the main chat provider directly via auto-detect
    try:
        kwargs = {
            "task": None,
            "messages": messages,
            "temperature": temperature or 0.1,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = int(max_tokens)
        return call_llm(**kwargs)
    except Exception as fallback_err:
        logger.error("TotalRecall LLM backend failed (primary=%s, fallback=%s)", primary_err, fallback_err)
        raise


# ---------------------------------------------------------------------------
# Tag extraction helper
# ---------------------------------------------------------------------------

# English stop words to filter out — these add no semantic value for tag matching
_TAG_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "because", "but", "and", "or", "if", "while", "that", "this", "these",
    "those", "it", "its", "i", "me", "my", "we", "our", "you", "your",
    "he", "him", "his", "she", "her", "they", "them", "their", "what",
    "which", "who", "whom", "am", "about", "up", "also", "get", "got",
    "let", "say", "said", "make", "like", "take", "come", "see", "know",
    "go", "think", "look", "want", "give", "use", "find", "tell", "ask",
    "work", "try", "call", "feel", "keep", "leave", "put", "mean", "new",
    "old", "long", "great", "little", "big", "high", "different", "small",
    "large", "next", "early", "young", "important", "few", "public",
    "bad", "good", "able", "help", "show", "every", "right", "thing",
    "things", "things", "way", "many", "much", "part", "things", "time",
    "things", "ask", "please", "help", "fix", "check", "look", "find",
    "tell", "show", "make", "want", "need", "use", "run", "set",
})

def _extract_tags(text: str) -> List[str]:
    """Extract meaningful tags from query text.

    Strategy:
    1. Split into tokens (words and hyphenated compounds)
    2. Filter stop words and short tokens
    3. Extract bigrams of adjacent meaningful tokens as compound tags
    4. Return both individual and compound tags for broader matching
    """
    if not text:
        return []

    # Split preserving hyphenated compounds
    tokens = re.split(r'[\s\W_]+', text.lower())
    words = [t for t in tokens if len(t) >= 3 and t not in _TAG_STOP_WORDS]

    if not words:
        return []

    # Build compound tags from adjacent meaningful words (bigrams)
    compounds = []
    for i in range(len(words) - 1):
        compounds.append(f"{words[i]}-{words[i + 1]}")

    # Return compounds + individual words; compounds first for better matching
    return list(dict.fromkeys(compounds + words))  # deduplicate, preserve order


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
            logger.info("TotalRecall initialized at %s (session=%s)", db_dir, session_id)
        except Exception as exc:
            logger.error("Failed to initialize TotalRecall: %s", exc, exc_info=True)
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
        unassigned = stats.get("unassigned", 0)

        if total_memories == 0:
            return (
                "# TotalRecall Memory\n"
                f"Active. {unassigned} turns pending compression — conversations are ingested per-turn and compressed at session end.\n"
                "Use totalrecall_compress to actively distill recent turns into durable memories."
            )

        level_lines = []
        for level in sorted(memories_by_level.keys()):
            count = memories_by_level[level]
            level_lines.append(f"L{level}: {count}")
        levels_str = ", ".join(level_lines)

        return (
            f"# TotalRecall Memory\n"
            f"Active. {total_memories} compressed memories ({levels_str}), {unassigned} turns pending.\n"
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
            result = self._tr.recall(tags, max_tokens=200_000, query_text=query)
            if not result or not result.strip():
                return ""
            return f"## TotalRecall Memory\n{result}"
        except Exception as exc:
            logger.warning("TotalRecall prefetch failed: %s", exc)
            return ""

    # -- Turn sync ----------------------------------------------------------

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "", messages: Optional[List[Dict[str, Any]]] = None) -> None:
        """Ingest a completed turn into TotalRecall."""
        if not self._tr:
            logger.warning("TotalRecall sync_turn skipped: _tr is None (initialization may have failed)")
            return
        if not user_content:
            logger.debug("TotalRecall sync_turn skipped: user_content is empty")
            return
        # Use passed session_id if provided (from memory_manager), fall back to cached
        effective_sid = session_id or self._session_id
        if not effective_sid:
            logger.warning("TotalRecall sync_turn skipped: no session_id available")
            return
        try:
            cmd_id = self._tr.ingest(effective_sid, user_content, assistant_content)
            logger.info("TotalRecall ingested command %d (session=%s, user_len=%d, assistant_len=%d)",
                       cmd_id, effective_sid, len(user_content), len(assistant_content or ""))
        except Exception as exc:
            logger.error("TotalRecall ingest failed: %s", exc, exc_info=True)

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

    # -- Session switch -----------------------------------------------------

    def on_session_switch(
        self,
        new_session_id: str,
        *,
        parent_session_id: str = "",
        reset: bool = False,
        rewound: bool = False,
        **kwargs,
    ) -> None:
        """Update session_id when the agent rotates to a new session.

        Before switching, assign any unassigned commands from the old session
        into chunks. Compression happens at session end, not during switch,
        to avoid blocking the agent on LLM calls.
        """
        if not self._tr:
            logger.warning("TotalRecall not initialized, skipping session-switch flush")
            return

        # Assign unassigned commands into chunks (no LLM call needed)
        try:
            stats = self._tr.status()
            unassigned = stats.get("unassigned", 0)
            if unassigned:
                logger.info(
                    "Session switch: assigning %d unassigned commands from session %s",
                    unassigned, self._session_id,
                )
                while True:
                    chunk_number = self._tr.assign_chunk()
                    if chunk_number is None:
                        break
                    logger.info("Session switch: assigned chunk %d", chunk_number)
        except Exception as exc:
            logger.error("Session switch assign failed: %s", exc, exc_info=True)

        # Update cached session_id
        self._session_id = new_session_id
        logger.info("TotalRecall session switched: %s -> %s", parent_session_id or "(none)", new_session_id)

    # -- Pre-compress hook --------------------------------------------------

    # Cap on how many chunks on_pre_compress will compress via LLM.
    # This prevents the hook from exhausting the auxiliary provider's
    # rate budget and starving the actual context compression that runs
    # immediately after.  The real compression happens in on_session_end.
    _PRE_COMPRESS_CHUNK_LIMIT = 2

    # Max consecutive LLM failures before bailing out of the LLM loop.
    # Rate-limit (429), budget exhaustion, or other provider errors that
    # recur indicate the auxiliary provider is under pressure.
    _PRE_COMPRESS_MAX_FAILS = 2

    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        """Flush unassigned commands before context compression discards them.

        Defensive about LLM budget: caps the number of chunks compressed
        and bails out on repeated LLM failures so the actual context
        compression (which runs immediately after this hook) is not
        starved of the auxiliary provider's rate budget.

        Returns empty string — TotalRecall doesn't contribute to the
        compression summary prompt itself.
        """
        if not self._tr:
            return ""
        try:
            stats = self._tr.status()
            unassigned = stats.get("unassigned", 0)
            if not unassigned:
                return ""

            logger.info("Pre-compress: %d unassigned commands to flush", unassigned)

            # Phase 1: Assign all unassigned commands into chunks (no LLM calls).
            # This ensures turns are not lost even if we skip compression below.
            chunks_assigned = 0
            while True:
                chunk_number = self._tr.assign_chunk()
                if chunk_number is None:
                    break
                chunks_assigned += 1
                logger.info("Pre-compress: assigned chunk %d", chunk_number)

            # Phase 2: Compress a limited number of chunks via LLM.
            # We cap this to avoid exhausting the auxiliary provider's
            # rate budget — the real compression happens in on_session_end.
            if chunks_assigned == 0:
                return ""

            compressed = 0
            consecutive_fails = 0

            # Re-query stats to find newly-created chunks that need compression.
            while compressed < self._PRE_COMPRESS_CHUNK_LIMIT:
                try:
                    # Try to compress the next pending chunk.
                    # assign_chunk returns None when all commands are chunked,
                    # so we need to get pending chunk IDs from the DB directly.
                    pending = self._tr.conn.execute(
                        "SELECT id FROM chunks WHERE compressed = 0 "
                        "ORDER BY created_at DESC LIMIT 1"
                    ).fetchall()
                    if not pending:
                        break
                    chunk_number = pending[0]["id"]
                    new_memory_ids = self._tr.compress_chunk(chunk_number)
                    if new_memory_ids:
                        compressed += 1
                        consecutive_fails = 0
                        logger.info("Pre-compress: compressed chunk %d -> %d memories",
                                   chunk_number, len(new_memory_ids))
                    else:
                        # Chunk had nothing to extract; count as success (not a failure).
                        consecutive_fails = 0
                        logger.debug("Pre-compress: chunk %d produced 0 memories", chunk_number)
                except CompressionError:
                    consecutive_fails += 1
                    logger.warning(
                        "Pre-compress: LLM compression failed (attempt %d), "
                        "bailing out to preserve rate budget for context compression",
                        consecutive_fails,
                    )
                    if consecutive_fails >= self._PRE_COMPRESS_MAX_FAILS:
                        logger.warning(
                            "Pre-compress: %d consecutive LLM failures — "
                            "skipping further compression to avoid starving "
                            "the actual context compression",
                            consecutive_fails,
                        )
                        break
                except Exception as exc:
                    # Catch-all for rate-limit, timeout, network errors, etc.
                    consecutive_fails += 1
                    logger.warning(
                        "Pre-compress: LLM call failed (%s, attempt %d), "
                        "bailing out to preserve rate budget for context compression",
                        type(exc).__name__, consecutive_fails,
                    )
                    if consecutive_fails >= self._PRE_COMPRESS_MAX_FAILS:
                        logger.warning(
                            "Pre-compress: %d consecutive failures — "
                            "skipping further compression to avoid starving "
                            "the actual context compression",
                            consecutive_fails,
                        )
                        break

            if compressed:
                logger.info("Pre-compress: compressed %d chunks (limit %d)",
                           compressed, self._PRE_COMPRESS_CHUNK_LIMIT)

        except Exception as exc:
            logger.error("Pre-compress flush failed: %s", exc, exc_info=True)
        return ""

    # -- Session end --------------------------------------------------------

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Run compression cycles at session boundary."""
        if not self._tr:
            logger.warning("TotalRecall not initialized, skipping session-end compression")
            return

        try:
            stats_before = self._tr.status()
            unassigned = stats_before.get("unassigned", 0)
            logger.info("Session end: TotalRecall has %d unassigned commands to compress", unassigned)

            # Phase 1: Assign and compress all remaining unchunked commands
            compressed_chunks = 0
            compression_errors = 0
            while True:
                chunk_number = self._tr.assign_chunk()
                if chunk_number is None:
                    break
                logger.info("Compressing chunk %d...", chunk_number)
                try:
                    new_memory_ids = self._tr.compress_chunk(chunk_number)
                    if new_memory_ids:
                        compressed_chunks += 1
                        logger.info("Compressed chunk %d -> %d L1 memories", chunk_number, len(new_memory_ids))
                    else:
                        logger.info("Chunk %d: LLM returned 0 memories (nothing to extract)", chunk_number)
                except CompressionError as ce:
                    compression_errors += 1
                    logger.error("Chunk %d compression FAILED: %s", chunk_number, ce)

            # Phase 2: Recursive compression of accumulated L1 memories
            stats_after = self._tr.status()
            l1_count = stats_after.get("memories_by_level", {}).get(1, 0)
            if l1_count > 5:
                logger.info("Triggering recursive compression for %d L1 memories", l1_count)
                self._recursive_compress_l1()

            final_stats = self._tr.status()
            logger.info(
                "Session end TotalRecall complete: %d chunks compressed, "
                "%d total memories, %d compression errors",
                compressed_chunks, final_stats.get("total_memories", 0),
                final_stats.get("llm_failure_count", 0),
            )

        except Exception as exc:
            logger.error("TotalRecall session-end compression failed: %s", exc, exc_info=True)

    def _recursive_compress_l1(self) -> None:
        """Compress accumulated L1 memories into higher-level summaries."""
        try:
            rows = self._tr.conn.execute(
                "SELECT id FROM memories WHERE level = 1 ORDER BY created_at DESC"
            ).fetchall()
            l1_ids = [r["id"] for r in rows]

            if len(l1_ids) < 3:
                logger.debug("Only %d L1 memories — skipping recursive compression", len(l1_ids))
                return

            batch_size = 20
            for i in range(0, len(l1_ids), batch_size):
                batch = l1_ids[i:i + batch_size]
                try:
                    new_ids = self._tr.compress_memories(batch)
                    if new_ids:
                        logger.info("Recursive compression: %d L1 -> %d higher-level memories",
                                    len(batch), len(new_ids))
                    else:
                        logger.info("Recursive compression: batch of %d produced 0 memories (nothing to extract)", len(batch))
                except CompressionError as ce:
                    logger.error("Recursive compression FAILED for batch of %d: %s", len(batch), ce)
        except Exception as exc:
            logger.error("Recursive L1 compression failed: %s", exc, exc_info=True)

    # -- Shutdown -----------------------------------------------------------

    def shutdown(self) -> None:
        """Close TotalRecall connection."""
        if self._tr:
            try:
                stats = self._tr.status()
                logger.info("TotalRecall shutting down: %d commands, %d memories",
                           stats.get("commands", 0), stats.get("total_memories", 0))
            except Exception:
                pass
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

            result = self._tr.recall(tags, max_tokens=max_tokens, query_text=query)
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
            chunk_number = self._tr.assign_chunk()
            if chunk_number is None:
                return json.dumps({
                    "status": "no_unassigned_commands",
                    "message": "No unassigned commands to compress. All ingested turns are already chunked.",
                })

            new_memory_ids = self._tr.compress_chunk(chunk_number)
            if not new_memory_ids:
                return json.dumps({
                    "status": "no_memories",
                    "chunk_number": chunk_number,
                    "message": "LLM extracted 0 memories from this chunk (nothing useful to retain).",
                })
            return json.dumps({
                "status": "compressed",
                "chunk_number": chunk_number,
                "new_memory_count": len(new_memory_ids),
                "memory_ids": new_memory_ids,
            })
        except CompressionError as ce:
            return tool_error(f"Compression failed: {ce}")
        except Exception as exc:
            logger.error("totalrecall_compress failed: %s", exc, exc_info=True)
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

    # Register the auxiliary LLM task so memory_compression resolves properly.
    # Defaults to 'auto' which picks up the main chat provider — users can
    # override in config.yaml under auxiliary.memory_compression if they want
    # a separate model for compression (e.g., a cheaper/faster model).
    try:
        ctx.register_auxiliary_task(
            key="memory_compression",
            display_name="TotalRecall Memory Compression",
            description="LLM calls for TotalRecall recursive memory distillation",
            defaults={
                "provider": "auto",
                "model": "",
                "base_url": "",
                "api_key": "",
                "timeout": 120,
                "extra_body": {},
            },
        )
        logger.info("Registered auxiliary task 'memory_compression' for TotalRecall")
    except Exception as exc:
        logger.warning("Failed to register memory_compression auxiliary task: %s", exc)
