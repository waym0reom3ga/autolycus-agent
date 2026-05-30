# Fix: Missing `HERMES_CADUCEUS` in `hermes_cli/banner.py`

## Problem

Running the autolycus agent via `lycus` produced a `NameError`:

```
NameError: name 'HERMES_CADUCEUS' is not defined
  File "hermes_cli/banner.py", line 520, in build_welcome_banner
    _hero = ... else HERMES_CADUCEUS
```

The same error occurred again in the exception handler at line 523.

## Root Cause

`HERMES_CADUCEUS` is a multi-line ASCII art string used as the default banner hero image. It was defined only in `cli.py:2695`, but referenced in `hermes_cli/banner.py:520,523` without an import.

A simple `from cli import HERMES_CADUCEUS` isn't viable because of a **circular import**:
- `cli.py` imports from `banner.py` (lines 168 and 809)
- If `banner.py` imports from `cli.py`, Python's module loader deadlocks

## Fix

Copied the `HERMES_CADUCEUS` constant definition directly into `hermes_cli/banner.py:26`, immediately after the logger initialization. This makes `banner.py` self-contained and eliminates the circular import risk.

### Modified File

- **`hermes_cli/banner.py`** — Added 15-line `HERMES_CADUCEUS` string constant at line 26 (after `logger = logging.getLogger(__name__)`).

No other files were changed. The existing definition in `cli.py:2695` remains as-is to avoid breaking any code that references it there directly.

## Verification

```bash
cd /home/waymore/compiled/autolycus-agent
python -c "from hermes_cli.banner import HERMES_CADUCEUS; print('OK')"
python -c "from hermes_cli.banner import build_welcome_banner; print('OK')"
```

Both imports succeed without error.
