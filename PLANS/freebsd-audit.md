# FreeBSD Compatibility Audit Report

**Date**: 2026-04-08  
**Task**: #14 - FreeBSD Compatibility Audit  
**Status**: In Progress  

---

## Executive Summary

The Autolycus codebase has **moderate FreeBSD compatibility issues**. Most core functionality should work, but several areas need attention:

1. ✅ **Core agent logic**: Platform-agnostic Python
2. ⚠️ **Terminal backends**: Docker/Singularity require container runtime; local backend needs PTY handling review
3. ❌ **Voice tools**: `faster-whisper` has no FreeBSD wheels (ctranslate2 dependency)
4. ⚠️ **Clipboard tools**: Platform-specific implementations needed for FreeBSD
5. ✅ **PTY support**: Graceful fallback when ptyprocess unavailable

---

## Findings by Category

### 1. Platform Detection Patterns

**Files with explicit Linux checks:**

| File | Line | Pattern | Impact |
|------|------|---------|--------|
| `hermes_cli/setup.py` | 1315, 2301 | `_platform.system() == "Linux"` | Setup script logic - needs FreeBSD branch |
| `hermes_cli/uninstall.py` | 123 | `platform.system() != "Linux"` | Uninstall may fail on FreeBSD |
| `hermes_cli/profiles.py` | 586, 605 | Linux/Darwin branches only | Profile management incomplete for FreeBSD |
| `tools/tirith_security.py` | 191 | `system == "Linux"` | Security tool platform detection |
| `tools/voice_mode.py` | 690 | `system == "Linux"` | Voice mode backend selection |

**Files with sys.platform checks:**

| File | Pattern | FreeBSD Status |
|------|---------|----------------|
| `tools/code_execution_tool.py:51` | `sys.platform != "win32"` | ✅ Works (FreeBSD passes) |
| `hermes_cli/clipboard.py:34-48` | darwin/win32 branches only | ❌ No FreeBSD clipboard support |
| `hermes_cli/status.py:310, 329` | linux/darwin branches | ⚠️ Missing FreeBSD status display |

---

### 2. PTY (Pseudo-Terminal) Support

**Location**: `tools/process_registry.py:209-241`

```python
try:
    from ptyprocess import PtyProcess as _PtyProcessCls
    _PTY_AVAILABLE = True
except ImportError:
    _PTY_AVAILABLE = False
    logger.warning("ptyprocess not installed, falling back to pipe mode")
```

**Status**: ✅ **Graceful fallback implemented**

The code already handles missing `ptyprocess` by falling back to pipe mode. FreeBSD users without ptyprocess will still have functional terminal execution, just without interactive PTY support for tools like vim/nano.

**Recommendation**: Document this limitation in README under FreeBSD section.

---

### 3. Docker/Singularity Backends

**Files**:
- `tools/environments/docker.py` - Full Docker environment implementation
- `tools/environments/singularity.py` (if exists) - Singularity support

**Status**: ⚠️ **Requires container runtime**

These backends require:
- Docker daemon running (`docker ps` works)
- OR Singularity installed (`singularity --version`)

FreeBSD has Docker support via `pkg install docker` but requires manual daemon setup.

**Recommendation**: 
1. Add FreeBSD-specific Docker setup instructions to README
2. Consider adding detection for FreeBSD Docker availability

---

### 4. Voice Tools (STT/TTS)

**Problem**: The `[voice]` extra depends on `faster-whisper`, which requires `ctranslate2`. No FreeBSD wheels exist for ctranslate2.

**Files affected**:
- `tools/voice_mode.py:684-690` - Platform-specific backend selection
- `pyproject.toml` - `[voice]` extra definition

**Status**: ❌ **Not available on FreeBSD**

**Workarounds**:
1. Use cloud STT providers (Groq, OpenAI) via env vars
2. Build ctranslate2 from source (complex, not recommended for prototype)
3. Exclude voice tools from FreeBSD installation

**Recommendation**: Add to README:
```markdown
### Voice Tools (FreeBSD Limitation)

The `[voice]` extra is **not available on FreeBSD** due to missing `ctranslate2` wheels.

Use cloud STT instead:
- Set `GROQ_API_KEY` for Groq Whisper (free tier)
- Set `VOICE_TOOLS_OPENAI_KEY` for OpenAI Whisper
```

---

### 5. Clipboard Tools

**File**: `hermes_cli/clipboard.py:34-48`

Current implementation only supports:
- macOS (`sys.platform == "darwin"`) - uses `pbcopy`/`pbpaste`
- Windows (`sys.platform == "win32"`) - uses `clip.exe`

**Status**: ❌ **No FreeBSD clipboard support**

FreeBSD can use:
- `xclip` (X11): `pkg install xclip`
- `xsel` (X11): `pkg install xsel`
- `osascript` equivalent: None native, but `pbcopy` works on some BSD variants

**Fix needed**:
```python
if sys.platform.startswith("freebsd"):
    # Try xclip first, then xsel
    try:
        subprocess.run(["xclip", "-selection", "clipboard"], input=text, ...)
    except FileNotFoundError:
        subprocess.run(["xsel"], input=text, ...)
```

---

### 6. Platform Map in Skills Tool

**File**: `tools/skills_tool.py:95-102` and `agent/skill_utils.py:109`

Current platform mapping:
```python
_PLATFORM_MAP = {
    "linux": "linux",
    "darwin": "macos", 
    "win32": "windows"
}
```

**Status**: ❌ **FreeBSD not mapped**

**Fix needed**:
```python
_PLATFORM_MAP = {
    "linux": "linux",
    "darwin": "macos",
    "freebsd": "freebsd",  # Add this
    "win32": "windows"
}
```

---

### 7. Setup Script FreeBSD Support

**File**: `hermes_cli/setup.py`

Current OS detection:
- Line 1315: `is_linux = _platform.system() == "Linux"`
- Line 2301-2302: Linux/MacOS branches only

**Status**: ⚠️ **Needs FreeBSD branch**

The setup script handles package installation differently per platform. FreeBSD uses `pkg` instead of `apt`/`brew`.

---

## Priority Fixes

### High Priority (Blockers)

1. **Add FreeBSD to `_PLATFORM_MAP`** in both:
   - `tools/skills_tool.py:96`
   - `agent/skill_utils.py:109`

2. **Document voice tool limitation** in README.md

3. **Fix setup script** to detect FreeBSD and use `pkg` for dependencies

### Medium Priority (Degraded Functionality)

4. **Add clipboard support** for FreeBSD using xclip/xsel

5. **Update status display** in `hermes_cli/status.py` to show FreeBSD correctly

6. **Test uninstall script** on FreeBSD or add FreeBSD branch

### Low Priority (Nice-to-have)

7. **Profile management** - Add FreeBSD-specific profile paths if needed

8. **Security tools** - Verify tirith_security works on FreeBSD

---

## Test Results (Current Session)

✅ **Verified Working**:
- `hermes --version` → Shows 0.8.0 correctly
- LM Studio API integration via OpenAI-compatible endpoint
- File read/write operations
- Basic Python package installation via `uv pip install`

⚠️ **Not Tested** (require FreeBSD):
- Terminal tool with local backend
- Docker/Singularity backends
- Clipboard operations
- Voice mode (expected to fail)

---

## Recommendations for om3ga

1. **Immediate**: Apply the `_PLATFORM_MAP` fixes (5-minute change)
2. **Short-term**: Add FreeBSD section to README documenting known limitations
3. **Medium-term**: Test terminal tool backends on actual FreeBSD system
4. **Long-term**: Consider creating `setup-freebsd.sh` script analogous to existing Linux/Mac setup

---

## Files Requiring Modification

| File | Change Needed | Lines |
|------|---------------|-------|
| `tools/skills_tool.py` | Add freebsd to _PLATFORM_MAP | 96 |
| `agent/skill_utils.py` | Add freebsd to _PLATFORM_MAP | 109 |
| `hermes_cli/clipboard.py` | Add FreeBSD clipboard implementation | 34-50 |
| `hermes_cli/status.py` | Add FreeBSD status display | 310-335 |
| `hermes_cli/setup.py` | Add FreeBSD package manager support | 1315+, 2301+ |
| `README.md` | Document FreeBSD limitations | New section |

---

*Report generated during Task #14 execution*  
*Next: Apply high-priority fixes and test on FreeBSD system*
