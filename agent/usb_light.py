"""USB Andon tower light integration for Lycus agent lifecycle signaling.

Auto-detects a CH340 USB serial device on import and provides no-op-safe
signal functions that flash colored lights at key lifecycle points:

- ``signal_start()``     -> green flash then off  (user message received)
- ``signal_done()``      -> yellow flash x3 + red for 30s  (response complete)
- ``signal_error()``     -> magenta                (error/failure)
- ``signal_permission()`` -> blue                  (permission request)

All functions are safe to call even when no device is detected — they become
silent no-ops. Device detection runs once at import time in a background thread
so it never blocks agent startup.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# ── Protocol constants ────────────────────────────────────────────────
# 5-byte packet: FF [light] [buzzer] [flash_freq] AA
# Light modes:   0x01=off, 0x02=green, 0x03=blue, 0x04=red,
#                0x06=yellow, 0x07=magenta
# Buzzer:        0x01 = OFF (safe), 0x02 = ON (loud — avoid)
# Flash freq:    0x01 = no flash (manual toggles only to avoid forced buzzer)

LIGHT_OFF     = 0x01
LIGHT_GREEN   = 0x02
LIGHT_BLUE    = 0x03
LIGHT_RED     = 0x04
LIGHT_YELLOW  = 0x06
LIGHT_MAGENTA = 0x07

BUZZER_OFF    = 0x01
FLASH_NONE    = 0x01

# ── Device state (set by background detector) ────────────────────────
_device_path: Optional[str] = None
_device_lock = threading.Lock()


def _build_packet(light_byte: int) -> bytes:
    """Build the 5-byte packet."""
    return bytes([0xFF, light_byte, BUZZER_OFF, FLASH_NONE, 0xAA])


def _send_packet(light_byte: int) -> bool:
    """Send a single 5-byte packet to the USB device.

    Returns True if successful, False otherwise (silent failure).
    Lazily detects device on first call if background detection hasn't found one yet.
    """
    global _device_path
    with _device_lock:
        port = _device_path
        if not port:
            port = _detect_device()
            if port:
                _device_path = port

    if not port or not os.path.exists(port):
        return False

    packet = _build_packet(light_byte)
    try:
        # Use python3 -c to write raw bytes directly (avoids shell escaping issues)
        import shlex
        escaped_port = shlex.quote(port)
        hex_str = ''.join(f'\\x{b:02X}' for b in packet)
        cmd = f"stty -F {escaped_port} raw 9600 cs8 -cstopb -parenb && printf '{hex_str}' > {escaped_port}"
        subprocess.run(cmd, shell=True, timeout=2,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception as e:
        logger.debug("USB light send failed: %s", e)
        return False


def _flash_sequence(on_byte: int, off_delay_s: float = 0.3, on_delay_s: float = 0.6) -> None:
    """Flash a color once (on -> delay -> off)."""
    _send_packet(LIGHT_OFF)
    if off_delay_s > 0:
        import time; time.sleep(off_delay_s)
    _send_packet(on_byte)
    if on_delay_s > 0:
        import time; time.sleep(on_delay_s)
    _send_packet(LIGHT_OFF)


def signal_start() -> None:
    """Green flash then off — called when user sends a message."""
    _flash_sequence(LIGHT_GREEN, off_delay_s=0.3, on_delay_s=0.6)


def signal_done() -> None:
    """Yellow flash x3 then solid red for 30s — called on successful completion."""
    import time
    _send_packet(LIGHT_OFF)
    time.sleep(0.3)
    for _ in range(3):
        _send_packet(LIGHT_YELLOW)
        time.sleep(0.6)
        _send_packet(LIGHT_OFF)
        time.sleep(0.3)
    _send_packet(LIGHT_RED)
    # Auto-turn off after 30 seconds via independent subprocess (survives process exit)
    port = _device_path or _detect_device()
    if port:
        packet_hex = ''.join(f'\\x{b:02X}' for b in _build_packet(LIGHT_OFF))
        import shlex
        escaped_port = shlex.quote(port)
        cmd = (f"sleep 30 && stty -F {escaped_port} raw 9600 cs8 -cstopb -parenb && "
               f"printf '{packet_hex}' > {escaped_port}")
        try:
            subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            logger.debug("USB light timer spawn failed: %s", e)


def signal_error() -> None:
    """Magenta on — called on error/failure."""
    _flash_sequence(LIGHT_MAGENTA, off_delay_s=0.3, on_delay_s=0.0)


def signal_permission() -> None:
    """Blue flash then off — called when permission is requested."""
    _flash_sequence(LIGHT_BLUE, off_delay_s=0.3, on_delay_s=0.6)


# ── Background device detector ───────────────────────────────────────

def _detect_device() -> Optional[str]:
    """Scan for CH340 USB serial devices via lsusb + sysfs.

    Returns the first matching /dev/ttyUSB* path, or None.
    """
    try:
        import glob

        candidates = sorted(glob.glob("/dev/ttyUSB*"))
        if not candidates:
            return None

        # Try to match via lsusb vendor ID (1a86 = QinHeng/CH340)
        try:
            result = subprocess.run(
                ["lsusb", "-d", "1a86:"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                logger.info("Detected USB Andon light at %s (CH340 via lsusb)", candidates[0])
                return candidates[0]
        except Exception:
            pass

        # Fallback: if only one ttyUSB device exists, use it
        if len(candidates) == 1:
            logger.info("Using single ttyUSB device: %s", candidates[0])
            return candidates[0]

    except Exception as e:
        logger.debug("USB light detection failed: %s", e)

    return None


def _detect_in_background() -> None:
    """Run device detection in a background thread to avoid blocking import."""
    global _device_path
    path = _detect_device()
    if path:
        with _device_lock:
            _device_path = path
        logger.info("USB Andon light ready at %s", path)
    else:
        logger.debug("No USB Andon light detected — signals will be no-ops")


# Start detection thread on import (daemon, won't block process exit)
_detect_thread = threading.Thread(target=_detect_in_background, daemon=True)
_detect_thread.start()
