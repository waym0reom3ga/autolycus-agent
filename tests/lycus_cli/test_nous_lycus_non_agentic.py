"""Tests for the Nous-Lycus-3/4 non-agentic warning detector.

Prior to this check, the warning fired on any model whose name contained
``"lycus"`` anywhere (case-insensitive). That false-positived on unrelated
local Modelfiles such as ``lycus-brain:qwen3-14b-ctx16k`` — a tool-capable
Qwen3 wrapper that happens to live under the "lycus" tag namespace.

``is_nous_lycus_non_agentic`` should only match the actual Nous Research
Lycus-3 / Lycus-4 chat family.
"""

from __future__ import annotations

import pytest

from lycus_cli.model_switch import (
    _HERMES_MODEL_WARNING,
    _check_lycus_model_warning,
    is_nous_lycus_non_agentic,
)


@pytest.mark.parametrize(
    "model_name",
    [
        "NousResearch/Lycus-3-Llama-3.1-70B",
        "NousResearch/Lycus-3-Llama-3.1-405B",
        "lycus-3",
        "Lycus-3",
        "lycus-4",
        "lycus-4-405b",
        "lycus_4_70b",
        "openrouter/lycus3:70b",
        "openrouter/nousresearch/lycus-4-405b",
        "NousResearch/Lycus3",
        "lycus-3.1",
    ],
)
def test_matches_real_nous_lycus_chat_models(model_name: str) -> None:
    assert is_nous_lycus_non_agentic(model_name), (
        f"expected {model_name!r} to be flagged as Nous Lycus 3/4"
    )
    assert _check_lycus_model_warning(model_name) == _HERMES_MODEL_WARNING


@pytest.mark.parametrize(
    "model_name",
    [
        # Kyle's local Modelfile — qwen3:14b under a custom tag
        "lycus-brain:qwen3-14b-ctx16k",
        "lycus-brain:qwen3-14b-ctx32k",
        "lycus-honcho:qwen3-8b-ctx8k",
        # Plain unrelated models
        "qwen3:14b",
        "qwen3-coder:30b",
        "qwen2.5:14b",
        "claude-opus-4-6",
        "anthropic/claude-sonnet-4.5",
        "gpt-5",
        "openai/gpt-4o",
        "google/gemini-2.5-flash",
        "deepseek-chat",
        # Non-chat Lycus models we don't warn about
        "lycus-llm-2",
        "lycus2-pro",
        "nous-lycus-2-mistral",
        # Edge cases
        "",
        "lycus",  # bare "lycus" isn't the 3/4 family
        "lycus-brain",
        "brain-lycus-3-impostor",  # "3" not preceded by /: boundary
    ],
)
def test_does_not_match_unrelated_models(model_name: str) -> None:
    assert not is_nous_lycus_non_agentic(model_name), (
        f"expected {model_name!r} NOT to be flagged as Nous Lycus 3/4"
    )
    assert _check_lycus_model_warning(model_name) == ""


def test_none_like_inputs_are_safe() -> None:
    assert is_nous_lycus_non_agentic("") is False
    # Defensive: the helper shouldn't crash on None-ish falsy input either.
    assert _check_lycus_model_warning("") == ""
