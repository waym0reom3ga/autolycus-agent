"""
First-run voice setup for Lycus Agent.

On the very first run, this module:
1. Asks the user if they want audio/voice integration
2. Detects GPU availability for local TTS
3. Generates a random voice reference sample for cloning
4. Generates and plays a greeting TTS using Chatterbox
5. Stores the voice preference in config.yaml

This is a one-time setup that runs before the first chat turn.
Subsequent runs skip this entirely.

Additionally provides end-of-task voice summaries when enabled.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Onboarding flag for tracking whether voice setup has been done
VOICE_SETUP_FLAG = "voice_setup_done"

# Chatterbox model repo
CHATTERBOX_REPO = "ResembleAI/chatterbox"

# Default voice reference directory
VOICE_REF_DIR = Path.home() / ".autolycus" / "voice" / "reference"


def _get_onboarding_config() -> Dict[str, Any]:
    """Load the onboarding config section."""
    try:
        from lycus_cli.config import load_config
        config = load_config()
        return config.get("onboarding", {})
    except Exception:
        return {}


def _set_onboarding_flag(flag: str) -> None:
    """Mark an onboarding flag as seen in config.yaml."""
    try:
        from lycus_cli.config import load_config, save_config
        config = load_config()
        config.setdefault("onboarding", {}).setdefault("seen", {})[flag] = True
        save_config(config)
    except Exception as e:
        logger.debug("Failed to save onboarding flag %s: %s", flag, e)


def voice_setup_done() -> bool:
    """Check if voice setup has already been completed."""
    onboarding = _get_onboarding_config()
    seen = onboarding.get("seen", {})
    return seen.get(VOICE_SETUP_FLAG, False)


def mark_voice_setup_done() -> None:
    """Mark voice setup as completed."""
    _set_onboarding_flag(VOICE_SETUP_FLAG)


def detect_gpu() -> Optional[str]:
    """Check for GPU availability. Returns 'cuda', 'mps', or None (cpu)."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return None


def get_audio_dir() -> Path:
    """Get the audio cache directory."""
    try:
        from lycus_constants import get_lycus_dir
        return Path(get_lycus_dir("cache/audio", "audio_cache"))
    except Exception:
        import tempfile
        return Path(tempfile.gettempdir()) / "lycus_voice"


def generate_greeting_tts(agent_name: str, audio_prompt_path: Optional[str] = None) -> Optional[str]:
    """Generate a greeting TTS audio file using Chatterbox.

    Returns the path to the generated audio file, or None on failure.
    """
    try:
        from chatterbox.tts import ChatterboxTTS
        import torchaudio as ta
        import torch

        greeting = (
            f"Hello! I'm {agent_name}, your AI assistant. "
            "I'm ready to help you with any task. What would you like to work on?"
        )

        # Detect device
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            device = "mps"

        # Load model
        model = ChatterboxTTS.from_pretrained(device=device)

        # Generate with optional voice reference
        kwargs = {}
        if audio_prompt_path and Path(audio_prompt_path).exists():
            kwargs["audio_prompt_path"] = audio_prompt_path

        wav = model.generate(greeting, **kwargs)

        # Output to cache directory
        output_dir = get_audio_dir()
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"greeting_{agent_name.lower()}.wav"

        ta.save(str(output_path), wav, model.sr)
        return str(output_path)
    except Exception as e:
        logger.debug("Failed to generate greeting TTS: %s", e)
        return None


def play_greeting(audio_path: str) -> bool:
    """Play the greeting audio file."""
    try:
        from tools.voice_mode import play_audio_file
        return play_audio_file(audio_path)
    except Exception as e:
        logger.debug("Failed to play greeting: %s", e)
        return False


def run_voice_setup() -> bool:
    """Run the first-run voice setup wizard.

    Returns True if voice was enabled, False otherwise.
    """
    try:
        from lycus_cli.config import load_config, save_config

        config = load_config()
        voice_cfg = config.get("voice", {})

        # Check if voice is already enabled
        if voice_cfg.get("enabled", False):
            return True

        # Ask user if they want voice
        print("\n" + "=" * 60)
        print("Voice Setup")
        print("=" * 60)
        print("\nChatterbox local TTS is available for voice generation.")
        print("This uses zero-shot voice cloning for consistent agent voice.")

        # Detect GPU
        gpu = detect_gpu()
        if gpu:
            print(f"\nGPU detected: {gpu} (TTS will be faster)")
        else:
            print("\nNo GPU detected (TTS will run on CPU)")

        # Ask for voice enablement
        enable = input("\nEnable voice generation? (y/n): ").strip().lower()
        if enable != "y":
            print("\nVoice generation disabled.")
            return False

        # Get agent name
        try:
            from agent.prompt_builder import get_lycus_agent_name
            agent_name = get_lycus_agent_name()
        except Exception:
            agent_name = "Lycus"

        # Generate greeting
        print(f"\nGenerating greeting for {agent_name}...")
        audio_path = generate_greeting_tts(agent_name)

        if audio_path:
            print(f"Greeting saved to: {audio_path}")
            play_greeting(audio_path)

            # Save config
            config.setdefault("voice", {})["enabled"] = True
            config["voice"]["provider"] = "chatterbox"
            config["voice"]["agent_name"] = agent_name
            save_config(config)

            mark_voice_setup_done()
            print("\nVoice setup complete!")
            return True
        else:
            print("\nFailed to generate greeting. Voice setup aborted.")
            return False

    except Exception as e:
        logger.error("Voice setup failed: %s", e)
        return False


def voice_summary_enabled() -> bool:
    """Check if end-of-task voice summaries are enabled."""
    try:
        from lycus_cli.config import load_config
        config = load_config()
        voice_cfg = config.get("voice", {})
        return voice_cfg.get("summaries", False)
    except Exception:
        return False


def generate_task_summary_tts(summary_text: str, audio_prompt_path: Optional[str] = None) -> Optional[str]:
    """Generate a task summary TTS audio file using Chatterbox.

    Returns the path to the generated audio file, or None on failure.
    """
    try:
        from chatterbox.tts import ChatterboxTTS
        import torchaudio as ta
        import torch

        # Detect device
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            device = "mps"

        # Load model
        model = ChatterboxTTS.from_pretrained(device=device)

        # Generate with optional voice reference
        kwargs = {}
        if audio_prompt_path and Path(audio_prompt_path).exists():
            kwargs["audio_prompt_path"] = audio_prompt_path

        wav = model.generate(summary_text, **kwargs)

        # Output to temp directory
        output_dir = get_audio_dir()
        output_dir.mkdir(parents=True, exist_ok=True)
        import time
        timestamp = int(time.time())
        output_path = output_dir / f"summary_{timestamp}.wav"

        ta.save(str(output_path), wav, model.sr)
        return str(output_path)
    except Exception as e:
        logger.debug("Failed to generate task summary TTS: %s", e)
        return None


def play_task_summary(summary_text: str) -> bool:
    """Generate and play a task summary voice message.

    Returns True if playback succeeded, False otherwise.
    """
    if not voice_summary_enabled():
        return False

    audio_path = generate_task_summary_tts(summary_text)
    if not audio_path:
        return False

    return play_greeting(audio_path)


if __name__ == "__main__":
    # Test the setup
    run_voice_setup()
