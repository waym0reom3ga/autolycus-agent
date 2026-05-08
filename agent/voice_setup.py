"""
First-run voice setup for Autolycus Agent.

On the very first run, this module:
1. Asks the user if they want audio/voice integration
2. Warns about NVIDIA GPU requirements for local TTS models
3. Detects gender from the agent name via LLM
4. Selects an appropriate Edge TTS voice
5. Generates and plays a greeting TTS
6. Stores the voice preference in config.yaml

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

# Edge TTS voices by gender category
# These are high-quality neural voices from Microsoft Edge
FEMALE_VOICES = {
    "en-US": "en-US-AriaNeural",       # Warm, conversational female
    "en-GB": "en-GB-SoniaNeural",      # British female
    "en-AU": "en-AU-NatashaNeural",    # Australian female
}

MALE_VOICES = {
    "en-US": "en-US-GuyNeural",        # Warm, conversational male
    "en-GB": "en-GB-RyanNeural",       # British male
    "en-AU": "en-AU-WilliamNeural",    # Australian male
}

NEUTRAL_VOICES = {
    "en-US": "en-US-JennyNeural",      # Professional, clear
}

DEFAULT_VOICE = "en-US-AriaNeural"


def _get_onboarding_config() -> Dict[str, Any]:
    """Load the onboarding config section."""
    try:
        from hermes_cli.config import load_config
        config = load_config()
        return config.get("onboarding", {})
    except Exception:
        return {}


def _set_onboarding_flag(flag: str) -> None:
    """Mark an onboarding flag as seen in config.yaml."""
    try:
        from hermes_cli.config import load_config, save_config
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


def detect_nvidia_gpu() -> bool:
    """Check if an NVIDIA GPU is present in the system."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0 and bool(result.stdout.strip())
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        return False


def nvidia_gpu_model() -> Optional[str]:
    """Get the NVIDIA GPU model name if present."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().split("\n")[0]
    except Exception:
        pass
    return None


def detect_gender_from_name(agent_name: str) -> str:
    """Use the LLM to detect the gender implied by the agent's name.
    
    Returns 'female', 'male', or 'neutral'.
    """
    # Simple heuristic fallback if LLM is unavailable
    female_names = {"nova", "aria", "luna", " stella", "aurora", "nova", "iris",
                    "jade", "sage", "ember", "aurora", "lyra", "seraphina",
                    "athena", "hera", "aria", "celeste", "divina", "elara",
                    "freya", "galadriel", "ishtar", "kalista", "maia",
                    "nadia", "odetta", "phoenix", "quinn", "renata", "selene",
                    "thea", "umbra", "violet", "willow", "xena", "yara", "zara"}
    
    male_names = {"orion", "apollo", "arthur", "daniel", "ethan", "felix",
                  "gauss", "hermes", "ivan", "jupiter", "kane", "leo",
                  "mars", "neo", "odin", "percy", "quintus", "rex",
                  "saturn", "thor", "ulric", "vector", "walt", "xander",
                  "yuri", "zeus", "adam", "brian", "caleb", "derek"}
    
    name_lower = agent_name.lower().strip()
    
    if name_lower in female_names:
        return "female"
    if name_lower in male_names:
        return "male"
    
    # Try LLM detection
    try:
        gender = _llm_detect_gender(agent_name)
        if gender in ("female", "male", "neutral"):
            return gender
    except Exception as e:
        logger.debug("LLM gender detection failed: %s", e)
    
    # Default to female for unknown names
    return "female"


def _llm_detect_gender(agent_name: str) -> str:
    """Use the local LLM to detect gender from the agent name."""
    try:
        from hermes_cli.config import load_config
        config = load_config()
        
        # Get the model config
        model_cfg = config.get("model", {})
        provider = model_cfg.get("provider", "")
        model = model_cfg.get("model", "")
        base_url = model_cfg.get("base_url", "")
        
        if not base_url:
            return "female"  # fallback
        
        # Build the API request
        api_key = model_cfg.get("api_key", "not-needed")
        
        import urllib.request
        import json
        
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a gender detector. Given a name, respond with ONLY "
                        "one word: 'female', 'male', or 'neutral'. "
                        "Consider cultural associations and common usage. "
                        "Do not explain your reasoning."
                    )
                },
                {
                    "role": "user",
                    "content": f"What gender does the name '{agent_name}' suggest?"
                }
            ],
            "max_tokens": 10,
            "temperature": 0.1
        }
        
        req = urllib.request.Request(
            f"{base_url}/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
        )
        
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            content = result["choices"][0]["message"]["content"].strip().lower()
            
            if "female" in content:
                return "female"
            elif "male" in content:
                return "male"
            else:
                return "neutral"
    except Exception as e:
        logger.debug("LLM gender detection failed: %s", e)
        return "female"  # safe fallback


def select_voice(gender: str, locale: str = "en-US") -> str:
    """Select an Edge TTS voice based on detected gender and locale."""
    if gender == "female":
        return FEMALE_VOICES.get(locale, FEMALE_VOICES["en-US"])
    elif gender == "male":
        return MALE_VOICES.get(locale, MALE_VOICES["en-US"])
    else:
        return NEUTRAL_VOICES.get(locale, NEUTRAL_VOICES["en-US"])


def generate_greeting_tts(agent_name: str, voice: str) -> Optional[str]:
    """Generate a greeting TTS audio file.
    
    Returns the path to the generated audio file, or None on failure.
    """
    try:
        import edge_tts
        
        greeting = (
            f"Hello! I'm {agent_name}, your AI assistant. "
            "I'm ready to help you with any task. What would you like to work on?"
        )
        
        # Output to temp directory
        output_dir = Path(tempfile_get_audio_dir())
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"greeting_{agent_name.lower()}.mp3"
        
        communicate = edge_tts.Communicate(greeting, voice)
        asyncio.run(communicate.save(str(output_path)))
        
        return str(output_path)
    except Exception as e:
        logger.debug("Failed to generate greeting TTS: %s", e)
        return None


def tempfile_get_audio_dir() -> str:
    """Get the audio cache directory."""
    try:
        from hermes_constants import get_hermes_dir
        return str(get_hermes_dir("cache/audio", "audio_cache"))
    except Exception:
        import tempfile
        return os.path.join(tempfile.gettempdir(), "hermes_voice")


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
    if voice_setup_done():
        return False
    
    try:
        from agent.prompt_builder import get_lycus_agent_name
        agent_name = get_lycus_agent_name()
    except Exception:
        agent_name = "Nova"
    
    # Check for NVIDIA GPU
    has_nvidia = detect_nvidia_gpu()
    gpu_model = nvidia_gpu_model()
    
    print("\n" + "=" * 60)
    print("  Autolycus Agent - First Run Voice Setup")
    print("=" * 60)
    print()
    print(f"  Welcome! Your agent's name is {agent_name}.")
    print()
    print("  Would you like to enable voice features?")
    print("  This includes:")
    print("    - Text-to-speech greetings and summaries")
    print("    - Voice output for task completion notifications")
    print()
    
    if has_nvidia:
        print(f"  NOTE: NVIDIA GPU detected ({gpu_model}).")
        print("  If you want local TTS models (NeuTTS, KittenTTS, Piper),")
        print("  GPU acceleration will be used automatically.")
        print("  WARNING: Local TTS models require significant VRAM.")
        print("  Edge TTS (cloud-based) is recommended for most users.")
        print()
    
    print("  Edge TTS (free, no API key) will be used by default.")
    print()
    
    try:
        response = input("  Enable voice features? (y/n): ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        response = "n"
    
    if response not in ("y", "yes"):
        print("\n  Voice features disabled. You can enable them later with /voice on.")
        print()
        mark_voice_setup_done()
        return False
    
    print("\n  Setting up voice...")
    
    # Detect gender from name
    gender = detect_gender_from_name(agent_name)
    print(f"  Detected gender for '{agent_name}': {gender}")
    
    # Select voice
    voice = select_voice(gender)
    print(f"  Selected voice: {voice}")
    
    # Ask about end-of-task summaries
    try:
        summary_response = input("  Enable end-of-task voice summaries? (y/n): ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        summary_response = "n"
    
    enable_summaries = summary_response in ("y", "yes")
    
    # Store in config
    try:
        from hermes_cli.config import load_config, save_config
        config = load_config()
        config.setdefault("tts", {})["provider"] = "edge"
        config.setdefault("tts", {}).setdefault("edge", {})["voice"] = voice
        config.setdefault("voice", {})["enabled"] = True
        config.setdefault("voice", {})["summaries"] = enable_summaries
        save_config(config)
        print("  Voice settings saved to config.yaml")
    except Exception as e:
        print(f"  Warning: Failed to save config: {e}")
    
    # Generate and play greeting
    print("\n  Generating greeting...")
    audio_path = generate_greeting_tts(agent_name, voice)
    
    if audio_path:
        print("  Playing greeting...")
        play_greeting(audio_path)
        print("  Greeting played!")
    else:
        print("  Warning: Could not generate greeting audio")
    
    # Mark setup as done
    mark_voice_setup_done()
    
    print("\n  Voice setup complete!")
    print()
    
    return True


def voice_summary_enabled() -> bool:
    """Check if end-of-task voice summaries are enabled."""
    try:
        from hermes_cli.config import load_config
        config = load_config()
        voice_cfg = config.get("voice", {})
        return voice_cfg.get("summaries", False)
    except Exception:
        return False


def generate_task_summary_tts(summary_text: str) -> Optional[str]:
    """Generate a task summary TTS audio file.
    
    Returns the path to the generated audio file, or None on failure.
    """
    try:
        import edge_tts
        from hermes_cli.config import load_config
        
        config = load_config()
        tts_config = config.get("tts", {})
        edge_config = tts_config.get("edge", {})
        voice = edge_config.get("voice", DEFAULT_VOICE)
        
        # Output to temp directory
        output_dir = Path(tempfile_get_audio_dir())
        output_dir.mkdir(parents=True, exist_ok=True)
        import time
        timestamp = int(time.time())
        output_path = output_dir / f"summary_{timestamp}.mp3"
        
        communicate = edge_tts.Communicate(summary_text, voice)
        asyncio.run(communicate.save(str(output_path)))
        
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
