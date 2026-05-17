"""Lycus branch: unified vision — no auxiliary model separation.

Modern multimodal models (qwen3.5+, qwen3.6) handle images natively
without needing a separate vision backend. This module replaces the
auxiliary vision pipeline with direct calls to the main model.

Importing this module applies the core patches automatically. The cli.py
patch is deferred to avoid circular imports (see patch_cli_preprocess).

Designed to be self-contained so upstream changes to hermes-agent do not
affect our lycus improvements.

Key changes:
  1. async_call_llm(task="vision") -> direct OpenAI call to main model
  2. decide_image_input_mode -> always returns "native"
  3. _preprocess_images_with_vision fallback -> simplified (patched from cli.py)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Simplified vision LLM call — talks to the main model, not an auxiliary one
# ---------------------------------------------------------------------------

async def _lycus_async_vision_call(
    messages: List[Dict[str, Any]],
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    tools: Optional[list] = None,
    **_kwargs,  # swallow extra kwargs from upstream (task, timeout, extra_body)
) -> Dict[str, Any]:
    """Call the main model with vision capabilities.

    Resolves the main provider credentials via resolve_runtime_provider,
    constructs an AsyncOpenAI client, and calls chat.completions.create.
    No auxiliary client, no fallback chain, no provider routing.

    Returns an OpenAI-style response object that the caller
    (vision_tools.py) expects via extract_content_or_reasoning.
    """
    from openai import AsyncOpenAI

    # Resolve main provider credentials
    from hermes_cli.runtime_provider import resolve_runtime_provider
    runtime = resolve_runtime_provider(requested="custom")

    api_key = runtime.get("api_key")
    base_url = runtime.get("base_url")
    resolved_model = model or runtime.get("model", "")

    # Local/custom endpoints often don't require auth
    if not api_key and base_url and "openrouter.ai" not in str(base_url):
        api_key = "no-key-required"

    if not base_url:
        raise RuntimeError("Lycus vision: no base_url resolved from runtime provider")

    client = AsyncOpenAI(api_key=api_key or "no-key-required", base_url=base_url)

    kwargs = {"model": resolved_model, "messages": messages}
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if tools is not None:
        kwargs["tools"] = tools

    logger.info(
        "Lycus unified vision: calling %s/%s (base_url=%s)",
        runtime.get("provider", "custom"), resolved_model, base_url,
    )

    response = await client.chat.completions.create(**kwargs)
    return response


# ---------------------------------------------------------------------------
# Patch: replace async_call_llm in BOTH source and consumer modules
# ---------------------------------------------------------------------------

def _patch_vision_tools():
    """Replace the auxiliary async_call_llm with our unified vision call.

    We patch TWO places:
    1. agent.auxiliary_client.async_call_llm — the source module
       (so any future `from agent.auxiliary_client import async_call_llm`
        picks up our version)
    2. tools.vision_tools.async_call_llm — the consumer's local reference
       (only if vision_tools is already imported)
    """
    # Patch the source module — catches future imports
    import agent.auxiliary_client as ac
    ac.async_call_llm = _lycus_async_vision_call

    # Patch the consumer module if already imported
    try:
        import tools.vision_tools as vt
        vt.async_call_llm = _lycus_async_vision_call
        logger.info("Lycus: patched tools.vision_tools to use unified vision call")
    except Exception:
        # vision_tools not imported yet — will be patched when it imports
        # because we already patched the source module above.
        logger.debug("Lycus: vision_tools not yet imported; source module patched")

    logger.info("Lycus: patched agent.auxiliary_client to use unified vision call")


# ---------------------------------------------------------------------------
# Patch: always use native image input mode
# ---------------------------------------------------------------------------

def _patch_image_routing():
    """Force decide_image_input_mode to always return 'native'.

    This means user-attached images are always sent as image_url content
    parts directly to the main model, never routed through the text
    description pipeline.
    """
    import agent.image_routing

    def lycus_decide_image_input_mode(provider: str, model: str, cfg: Any) -> str:
        return "native"

    agent.image_routing.decide_image_input_mode = lycus_decide_image_input_mode

    logger.info("Lycus: patched agent.image_routing to always use native mode")


# ---------------------------------------------------------------------------
# Patch: simplify _preprocess_images_with_vision fallback in cli.py
# (Deferred — called from cli.py after ChatConsole class is defined)
# ---------------------------------------------------------------------------

def _lycus_preprocess_images_with_vision(
    self, text: str, images: list, *, announce: bool = True
) -> str:
    """Simplified fallback: just include image paths, don't call vision API.

    The main model can see the images natively, so pre-processing
    through a vision API is redundant. We include the path so the
    agent can reference them if needed.

    Designed to replace ChatConsole._preprocess_images_with_vision.
    """
    from pathlib import Path
    from cli import _DIM, _RST, _cprint

    enriched_parts = []
    for img_path in images:
        if not hasattr(img_path, 'exists'):
            img_path = Path(img_path)
        if not img_path.exists():
            continue
        size_kb = img_path.stat().st_size // 1024
        if announce:
            _cprint(f"  {_DIM}📎 image attached: {img_path.name} ({size_kb}KB){_RST}")
        enriched_parts.append(
            f"[The user attached an image: {img_path.name} ({size_kb}KB). "
            f"The image is included natively in the conversation. "
            f"If you need a closer look, use vision_analyze with "
            f"image_url: {img_path}]"
        )

    user_text = text if isinstance(text, str) and text else ""
    if enriched_parts:
        prefix = "\n\n".join(enriched_parts)
        return f"{prefix}\n\n{user_text}" if user_text else prefix
    return user_text or "What do you see in this image?"


def patch_cli_preprocess(chat_console_class):
    """Apply the cli preprocess patch. Call from cli.py after ChatConsole is defined.

    Args:
        chat_console_class: The ChatConsole class to patch.
    """
    chat_console_class._preprocess_images_with_vision = _lycus_preprocess_images_with_vision
    logger.info("Lycus: patched ChatConsole._preprocess_images_with_vision")


# ---------------------------------------------------------------------------
# Patch: update vision_analyze tool description for unified vision
# ---------------------------------------------------------------------------

def _patch_vision_schema():
    """Update the vision_analyze schema description to reflect unified vision.

    The old description mentions 'auxiliary vision model' and 'non-vision
    models fall back'. In the lycus branch, the main model handles everything.
    """
    try:
        import tools.vision_tools as vt
        vt.VISION_ANALYZE_SCHEMA["description"] = (
            "Load an image into the conversation so you can see it. Accepts a "
            "URL, local file path, or data URL. The active model has native "
            "vision capabilities — the image is attached directly and you read "
            "the pixels yourself on the next turn. Call this any time the user "
            "references an image (filepath in their message, URL in tool output, "
            "screenshot from the browser, etc.)."
        )
        logger.info("Lycus: updated vision_analyze schema description")
    except Exception:
        logger.debug("Lycus: vision_tools not yet imported; schema patch deferred")


# ---------------------------------------------------------------------------
# Apply core patches at import time (cli patch is deferred)
# ---------------------------------------------------------------------------

def apply_lycus_vision_patches():
    """Apply all lycus vision patches except the cli preprocess one."""
    _patch_vision_tools()
    _patch_image_routing()
    _patch_vision_schema()
    logger.info("Lycus unified vision: core patches applied")


# Auto-apply core patches on import
apply_lycus_vision_patches()
