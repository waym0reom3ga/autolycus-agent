"""Temporal activities for controlling the Andon tower light."""

import asyncio
import subprocess
from temporalio import activity

# Light control commands (from existing scripts)
LIGHT_OFF = b'\xFF\x01\x01\x01\xAA'  # All off
LIGHT_GREEN = b'\xFF\x02\x01\x01\xAA'  # Green on
LIGHT_RED = b'\xFF\x04\x01\x01\xAA'  # Red on
LIGHT_YELLOW = b'\xFF\x06\x01\x01\xAA'  # Yellow on

TTY_DEVICE = '/dev/ttyUSB0'


def _send_command(cmd: bytes) -> None:
    """Send a raw command to the Andon light via serial."""
    import os
    fd = os.open(TTY_DEVICE, os.O_WRONLY | os.O_NOCTTY)
    try:
        subprocess.run(
            ['stty', '-F', TTY_DEVICE, 'raw', '9600', 'cs8', '-cstopb', '-parenb'],
            check=False, timeout=2
        )
        os.write(fd, cmd)
    finally:
        os.close(fd)


@activity.defn
async def flash_green_once() -> str:
    """Flash green once then turn off (task started signal)."""
    _send_command(LIGHT_OFF)
    await asyncio.sleep(0.3)
    _send_command(LIGHT_GREEN)
    await asyncio.sleep(0.6)
    _send_command(LIGHT_OFF)
    return "green_flash_done"


@activity.defn
async def flash_yellow_three_times() -> str:
    """Flash yellow 3 times (task finished signal)."""
    for _ in range(3):
        _send_command(LIGHT_YELLOW)
        await asyncio.sleep(0.6)
        _send_command(LIGHT_OFF)
        await asyncio.sleep(0.3)
    return "yellow_flash_done"


@activity.defn
async def set_solid_red() -> str:
    """Set solid red (error/attention state)."""
    _send_command(LIGHT_RED)
    return "solid_red_set"


@activity.defn
async def turn_off_light() -> str:
    """Turn off all lights."""
    _send_command(LIGHT_OFF)
    return "light_off"
