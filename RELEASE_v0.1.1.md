# Release v0.1.1 — Lycus Unified Vision

**Date:** May 17, 2026

## Summary

Eliminates the auxiliary vision model paradigm entirely. Modern multimodal models (qwen3.5+, qwen3.6) handle images natively without needing a separate vision backend. The lycus branch now routes all image processing through the main model, eliminating redundant API calls, secondary model loading, and credit drain on auxiliary backends.

## Changes

### New: Unified Vision Pipeline (`agent/lycus_vision.py`)

A self-contained module (9KB) that replaces the 4700-line auxiliary client chain with a direct OpenAI-compatible call to the main model.

**Key features:**
- `_lycus_async_vision_call()` — Simplified async LLM call (~50 lines)
  - Resolves main provider credentials via `resolve_runtime_provider(requested="custom")`
  - Constructs `AsyncOpenAI` client with same base_url, API key, and model as the main conversation
  - No secondary model loading, no fallback chain, no provider routing

- Runtime monkey-patching at 4 injection points:
  1. `agent.auxiliary_client.async_call_llm` → `_lycus_async_vision_call` (source module patch)
  2. `tools.vision_tools.async_call_llm` → `_lycus_async_vision_call` (consumer patch)
  3. `agent.image_routing.decide_image_input_mode` → always returns `"native"`
  4. `cli.ChatConsole._preprocess_images_with_vision` → simplified fallback (no API call)

### Modified: `cli.py` (2 small additions)

- Line 48: `import agent.lycus_vision` (triggers all patches at startup)
- Line 2323: `agent.lycus_vision.patch_cli_preprocess(ChatConsole)` (applies CLI patch after class definition)

### Updated: Vision Tool Schema

The `vision_analyze` tool description no longer references "auxiliary vision model" or "non-vision model fallback". Updated to reflect that the active model has native vision capabilities.

## Technical Details

### Before (auxiliary vision pipeline)

```
User image → vision_analyze_tool()
  → async_call_llm(task="vision")
    → resolve_vision_provider_client() [4700 lines]
      → Gemini Flash / separate vision backend
        → text description returned to agent
```

### After (unified vision)

```
User image → vision_analyze_tool()
  → _lycus_async_vision_call()
    → resolve_runtime_provider(requested="custom")
      → Same main model (qwen3.6) handles everything
        → Native image understanding, no information loss
```

### Why This Survives Upstream Changes

- `agent/lycus_vision.py` is a **new file** — upstream merges won't touch it
- The 2 cli.py changes are single-line imports/patches that are easy to re-apply
- The patches use runtime monkey-patching, so they work regardless of upstream function signatures
- No modifications to existing upstream files beyond the 2 import statements

## Benefits

1. **No credit drain** — vision calls hit the same model as the main conversation
2. **No secondary model loading** — eliminates the 90-second sleep workaround for VRAM OOM during compression
3. **No information loss** — main model sees actual pixels, not a lossy text description
4. **Simpler code** — 9KB replacement for 4700-line auxiliary client chain
5. **Faster responses** — no extra API round-trip for vision processing

## Compatibility

- Requires a multimodal-capable main model (qwen3.5+, qwen3.6, or equivalent)
- Falls back gracefully if lycus_vision import fails (upstream behavior preserved)
- All existing vision tools (`vision_analyze`, `browser_vision`) continue to work
- No changes to the config schema — `auxiliary.vision` settings are simply ignored

## Testing

All patches verified:
- `auxiliary_client.async_call_llm` → `_lycus_async_vision_call` ✓
- `vision_tools.async_call_llm` → `_lycus_async_vision_call` ✓
- `image_routing.decide_image_input_mode` → always `"native"` ✓
- `ChatConsole._preprocess_images_with_vision` → simplified fallback ✓
- `vision_analyze` schema description updated ✓
