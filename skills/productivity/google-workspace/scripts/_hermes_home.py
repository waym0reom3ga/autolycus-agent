"""Resolve AUTOLYCUS_HOME for standalone skill scripts.

Skill scripts may run outside the Lycus process (e.g. system Python,
nix env, CI) where ``lycus_constants`` is not importable.  This module
provides the same ``get_lycus_home()`` and ``display_lycus_home()``
contracts as ``lycus_constants`` without requiring it on ``sys.path``.

When ``lycus_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``lycus_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``AUTOLYCUS_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from lycus_constants import display_lycus_home as display_lycus_home
    from lycus_constants import get_lycus_home as get_lycus_home
except (ModuleNotFoundError, ImportError):

    def get_lycus_home() -> Path:
        """Return the Lycus home directory (default: ~/.autolycus).

        Mirrors ``lycus_constants.get_lycus_home()``."""
        val = os.environ.get("AUTOLYCUS_HOME", "").strip()
        return Path(val) if val else Path.home() / ".autolycus"

    def display_lycus_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``lycus_constants.display_lycus_home()``."""
        home = get_lycus_home()
        try:
            return "~/" + str(home.relative_to(Path.home()))
        except ValueError:
            return str(home)
