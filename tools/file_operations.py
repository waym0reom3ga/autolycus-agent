#!/usr/bin/env python3
"""
File Operations Module

Provides file manipulation capabilities (read, write, patch, search) that work
across all terminal backends (local, docker, ssh, singularity, modal, daytona).

The key insight is that all file operations can be expressed as shell commands,
so we wrap the terminal backend's execute() interface to provide a unified file API.

Usage:
    from tools.file_operations import ShellFileOperations
    from tools.terminal_tool import _active_environments
    
    # Get file operations for a terminal environment
    file_ops = ShellFileOperations(terminal_env)
    
    # Read a file
    result = file_ops.read_file("/path/to/file.py")
    
    # Write a file
    result = file_ops.write_file("/path/to/new.py", "print('hello')")
    
    # Search for content
    result = file_ops.search("TODO", path=".", file_glob="*.py")
"""

import os
import re
import difflib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from pathlib import Path
from tools.binary_extensions import BINARY_EXTENSIONS

from agent.file_safety import (
    build_write_denied_paths,
    build_write_denied_prefixes,
    is_write_denied as _shared_is_write_denied,
)


# ---------------------------------------------------------------------------
# Write-path deny list — blocks writes to sensitive system/credential files
# ---------------------------------------------------------------------------

_HOME = str(Path.home())

WRITE_DENIED_PATHS = build_write_denied_paths(_HOME)

WRITE_DENIED_PREFIXES = build_write_denied_prefixes(_HOME)


_OSC_SEQUENCE_RE = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
_FENCE_MARKER_RE = re.compile(r"'?\x07?__HERMES_FENCE_[A-Za-z0-9]+__\x07?'?")


def _strip_terminal_fence_leaks(text: str) -> str:
    """Strip leaked terminal fence wrappers from file read output."""
    if not text:
        return text

    cleaned_lines: List[str] = []
    for line in text.splitlines(keepends=True):
        had_terminal_wrapper = "__HERMES_FENCE_" in line or "\x1b]" in line
        cleaned = _OSC_SEQUENCE_RE.sub("", line)
        cleaned = _FENCE_MARKER_RE.sub("", cleaned)
        cleaned = cleaned.replace("\x07", "")
        if had_terminal_wrapper and cleaned.strip("'\r\n\t ") == "":
            continue
        cleaned_lines.append(cleaned)
    return "".join(cleaned_lines)


def _detect_line_ending(sample: str) -> Optional[str]:
    """Return the dominant line ending in ``sample`` or None if undetermined.

    Looks at the first few line breaks and picks ``\\r\\n`` if any are
    present (Windows / DOS), otherwise ``\\n`` (Unix).  Returns ``None``
    for empty / single-line content where we can't tell.  Used to
    preserve the file's original line endings across write_file and
    patch operations — without this the agent's bare-LF tool args
    silently normalize Windows-line-ending files, and patch produces
    mixed endings when only a substituted region changes.
    """
    if not sample:
        return None
    # Look at the first chunk — enough to tell, cheap to scan.
    head = sample[:4096]
    if "\r\n" in head:
        return "\r\n"
    if "\n" in head:
        return "\n"
    return None


def _normalize_line_endings(text: str, target: str) -> str:
    """Convert all line endings in ``text`` to ``target`` (``\\n`` or ``\\r\\n``).

    Idempotent: ``_normalize_line_endings(_normalize_line_endings(x, "\\r\\n"), "\\r\\n") == _normalize_line_endings(x, "\\r\\n")``.
    Strips lone ``\\r`` characters as well, so mixed-ending content is
    homogenized in a single pass.
    """
    # First collapse to LF (handle CRLF and lone CR), then expand if target
    # is CRLF.  Order matters: doing the replacements separately would
    # double-convert a CRLF -> LFLF.
    lf_normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if target == "\n":
        return lf_normalized
    if target == "\r\n":
        return lf_normalized.replace("\n", "\r\n")
    return text


# UTF-8 byte order mark. Some Windows editors (Notepad, older Visual Studio,
# some PowerShell redirects) prepend this invisible 3-byte marker
# (EF BB BF == U+FEFF) to UTF-8 text files. It renders as nothing but is a
# real character at the start of the decoded string, so without handling it:
#   - read_file would surface a stray U+FEFF as the first character (the
#     model sees a phantom char before `import ...`), and
#   - patch matches against the true first line would miss, and write_file
#     would silently drop or double the marker on rewrite.
# We strip it on read so the model sees clean content, and restore it on
# write when the original file had one — exactly mirroring the line-ending
# preservation above (detect on disk, preserve across the edit).
_UTF8_BOM = "\ufeff"


def _strip_bom(text: str) -> tuple[str, bool]:
    """Return (text-without-leading-BOM, had_bom).

    Only a single leading BOM is stripped; a BOM appearing mid-content is
    left alone (it's legitimate data there, not a file marker).
    """
    if text and text.startswith(_UTF8_BOM):
        return text[len(_UTF8_BOM):], True
    return text, False


def _has_bom(text: Optional[str]) -> bool:
    """True if ``text`` begins with a UTF-8 BOM."""
    return bool(text) and text.startswith(_UTF8_BOM)


def _is_write_denied(path: str) -> bool:
    """Return True if path is on the write deny list."""
    return _shared_is_write_denied(path)


# =============================================================================
# Result Data Classes
# =============================================================================

@dataclass
class ReadResult:
    """Result from reading a file."""
    content: str = ""
    total_lines: int = 0
    file_size: int = 0
    truncated: bool = False
    hint: Optional[str] = None
    is_binary: bool = False
    is_image: bool = False
    base64_content: Optional[str] = None
    mime_type: Optional[str] = None
    dimensions: Optional[str] = None  # For images: "WIDTHxHEIGHT"
    error: Optional[str] = None
    similar_files: List[str] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None and v != []}


@dataclass
class WriteResult:
    """Result from writing a file."""
    bytes_written: int = 0
    dirs_created: bool = False
    lint: Optional[Dict[str, Any]] = None
    # Semantic diagnostics from the LSP layer, when applicable.  Kept in
    # its own field (not folded into ``lint``) so the model and any
    # downstream parsers can read syntax errors and semantic errors as
    # separate signals.  ``None`` when LSP is disabled, when the file
    # isn't in a git workspace, or when no diagnostics were introduced
    # by this edit.
    lsp_diagnostics: Optional[str] = None
    error: Optional[str] = None
    warning: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class PatchResult:
    """Result from patching a file."""
    success: bool = False
    diff: str = ""
    files_modified: List[str] = field(default_factory=list)
    files_created: List[str] = field(default_factory=list)
    files_deleted: List[str] = field(default_factory=list)
    lint: Optional[Dict[str, Any]] = None
    # See :class:`WriteResult.lsp_diagnostics`.
    lsp_diagnostics: Optional[str] = None
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        result = {"success": self.success}
        if self.diff:
            result["diff"] = self.diff
        if self.files_modified:
            result["files_modified"] = self.files_modified
        if self.files_created:
            result["files_created"] = self.files_created
        if self.files_deleted:
            result["files_deleted"] = self.files_deleted
        if self.lint:
            result["lint"] = self.lint
        if self.lsp_diagnostics:
            result["lsp_diagnostics"] = self.lsp_diagnostics
        if self.error:
            result["error"] = self.error
        return result


@dataclass
class SearchMatch:
    """A single search match."""
    path: str
    line_number: int
    content: str
    mtime: float = 0.0  # Modification time for sorting


@dataclass
class SearchResult:
    """Result from searching."""
    matches: List[SearchMatch] = field(default_factory=list)
    files: List[str] = field(default_factory=list)
    counts: Dict[str, int] = field(default_factory=dict)
    total_count: int = 0
    truncated: bool = False
    limit_reason: Optional[str] = None
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        result: dict[str, object] = {"total_count": self.total_count}
        if self.matches:
            result["matches"] = [
                {"path": m.path, "line": m.line_number, "content": m.content}
                for m in self.matches
            ]
        if self.files:
            result["files"] = self.files
        if self.counts:
            result["counts"] = self.counts
        if self.truncated:
            result["truncated"] = True
        if self.limit_reason:
            result["limit_reason"] = self.limit_reason
        if self.error:
            result["error"] = self.error
        return result


@dataclass
class LintResult:
    """Result from linting a file."""
    success: bool = True
    skipped: bool = False
    output: str = ""
    message: str = ""
    
    def to_dict(self) -> dict:
        if self.skipped:
            return {"status": "skipped", "message": self.message}
        result = {"status": "ok" if self.success else "error", "output": self.output}
        if self.message:
            result["message"] = self.message
        return result


@dataclass
class ExecuteResult:
    """Result from executing a shell command."""
    stdout: str = ""
    exit_code: int = 0


_SEARCH_TIMEOUT_MARKER_RE = re.compile(r"\n?\[Command timed out after \d+s\]\s*$")


def _search_stdout_and_limit(result: ExecuteResult) -> tuple[str, Optional[str]]:
    """Return stdout cleaned for parsing and a limit reason for search timeouts."""
    if result.exit_code == 124:
        return _SEARCH_TIMEOUT_MARKER_RE.sub("", result.stdout), "search_timeout"
    return result.stdout, None


def _split_tool_diagnostics(output: str) -> tuple[str, str]:
    """Separate rg/grep diagnostic lines from real match output.

    ``_exec`` runs commands with ``stderr=subprocess.STDOUT``, so error and
    warning text from ``rg``/``grep`` is interleaved with match lines in a
    single stream. Diagnostics must not be parsed as matches, and on a hard
    failure they are the error message to surface.

    Returns ``(diagnostics, payload)`` where ``payload`` contains only lines
    that look like real search output — a match line (``file:line:content``),
    a files-only path, a count line, or a context line/separator. Everything
    else (tool-prefixed errors, rg's multi-line ``regex parse error`` block
    with its indented carets, blank lines) is folded into ``diagnostics``.

    Classifying by *shape* rather than by error prefix is what lets the
    exit-2 guard distinguish a pure failure (no usable payload → surface the
    error) from a partial failure (some files matched, one was unreadable →
    keep the matches). It also means error text can never be mis-parsed as a
    match, a latent bug that predates the exit-code fix.
    """
    diagnostics: list[str] = []
    payload: list[str] = []
    for line in output.split('\n'):
        if not line.strip():
            continue
        # Tool diagnostics always carry the "<tool>: " prefix (e.g.
        # "rg: <file>: Permission denied", "grep: Invalid regular
        # expression", "rg: regex parse error:"). Check this first: a real
        # match path can legitimately contain "-<digit>" (e.g. a tmp dir like
        # ".../pytest-686/..."), which the shape regex would otherwise treat
        # as a match line.
        stripped = line.lstrip()
        if stripped.startswith("rg: ") or stripped.startswith("grep: "):
            diagnostics.append(line)
            continue
        # Otherwise classify by output shape. rg's regex-parse-error block
        # also emits an indented caret line and a trailing "error: ..." line
        # with no tool prefix; neither matches a search-output shape, so they
        # fall through to diagnostics.
        #   match / count : "<path>:<...>"   (has a colon; rg -c uses path:count)
        #   files_only    : "<path>"         (no whitespace, no leading colon)
        #   context line  : "<path>-<line>-" or the "--" group separator
        if line == "--" or _SEARCH_OUTPUT_RE.match(line):
            payload.append(line)
        else:
            diagnostics.append(line)
    return '\n'.join(diagnostics), '\n'.join(payload)


# A real rg/grep output line starts with a path token and is followed by a
# ``:`` (match/count), a ``-`` (context), or nothing (files_only). Tool
# diagnostics ("rg: ...", "grep: ...", "error: ...", indented carets) never
# match because the path token forbids whitespace and a leading tool prefix
# like "rg" is followed by ": " (space) which the negated class rejects.
_SEARCH_OUTPUT_RE = re.compile(r'^([A-Za-z]:)?[^\s:][^\n]*?[:\-]\d|^[^\s:][^\s]*$')


def _parse_search_context_line(line: str) -> tuple[str, int, str] | None:
    """Parse grep/rg context output in ``path-line-content`` format.

    Context lines are ambiguous because filenames may legitimately contain
    ``-<digits>-`` segments. Prefer the rightmost numeric separator so a path
    like ``dir/file-12-name.py-8-context`` resolves to
    ``dir/file-12-name.py`` line ``8`` instead of truncating at ``file``.
    """
    if not line or line == "--":
        return None

    match = None
    for candidate in re.finditer(r'-(\d+)-', line):
        match = candidate

    if match is None:
        return None

    path = line[:match.start()]
    if not path:
        return None

    return path, int(match.group(1)), line[match.end():]


# =============================================================================
# Abstract Interface
# =============================================================================

class FileOperations(ABC):
    """Abstract interface for file operations across terminal backends."""
    
    @abstractmethod
    def read_file(self, path: str, offset: int = 1, limit: int = 500) -> ReadResult:
        """Read a file with pagination support."""
        ...

    @abstractmethod
    def read_file_raw(self, path: str) -> ReadResult:
        """Read the complete file content as a plain string.

        No pagination, no line-number prefixes, no per-line truncation.
        Returns ReadResult with .content = full file text, .error set on
        failure. Always reads to EOF regardless of file size.
        """
        ...

    @abstractmethod
    def write_file(self, path: str, content: str) -> WriteResult:
        """Write content to a file, creating directories as needed."""
        ...

    @abstractmethod
    def patch_replace(self, path: str, old_string: str, new_string: str,
                      replace_all: bool = False) -> PatchResult:
        """Replace text in a file using fuzzy matching."""
        ...

    @abstractmethod
    def patch_v4a(self, patch_content: str) -> PatchResult:
        """Apply a V4A format patch."""
        ...

    @abstractmethod
    def delete_file(self, path: str) -> WriteResult:
        """Delete a file. Returns WriteResult with .error set on failure."""
        ...

    def delete_path(self, path: str, recursive: bool = False) -> WriteResult:
        """Cross-platform delete that handles files and (with recursive=True)
        directory trees. Default implementation delegates to ``delete_file``
        for the non-recursive case; backends with native recursive support
        should override.
        """
        if recursive:
            return WriteResult(error="Recursive delete not implemented for this backend")
        return self.delete_file(path)

    @abstractmethod
    def move_file(self, src: str, dst: str) -> WriteResult:
        """Move/rename a file from src to dst. Returns WriteResult with .error set on failure."""
        ...

    @abstractmethod
    def search(self, pattern: str, path: str = ".", target: str = "content",
               file_glob: Optional[str] = None, limit: int = 50, offset: int = 0,
               output_mode: str = "content", context: int = 0) -> SearchResult:
        """Search for content or files."""
        ...


# =============================================================================
# Shell-based Implementation
# =============================================================================

# Image extensions (subset of binary that we can return as base64)
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'}

# Shell-based linters by file extension.  Invoked via _exec() with the
# filesystem path.  Cover languages where a compile/type check needs an
# external toolchain (py_compile, node, tsc, go vet).
LINTERS = {
    '.py': 'python -m py_compile {file} 2>&1',
    '.js': 'node --check {file} 2>&1',
    '.ts': 'npx tsc --noEmit {file} 2>&1',
    '.go': 'go vet {file} 2>&1',
    '.rs': 'rustc --edition 2024 --crate-type lib {file} 2>&1',
}

# Extensions where the per-file shell linter is structurally weaker than
# a real LSP server AND produces phantom errors on real-world projects:
#
# - ``.ts``: ``tsc --noEmit FILE.ts`` ignores ``tsconfig.json`` and
#   defaults to no-lib / ES5, so every ES2015+ stdlib reference
#   (``Promise``, ``Map``, ``Set``, ``ReadonlySet``, ``Iterable``,
#   ``Math.imul``, ``Number.isFinite``, etc.) reports as missing.  This
#   floods the agent's lint field with 20K+ tokens of false positives on
#   every edit.  No supported tsc flag fixes the single-file invocation;
#   the canonical replacement is ``tsserver`` via LSP, which respects
#   tsconfig and gives true diagnostics.
#
#   ``.tsx`` is intentionally NOT in ``LINTERS`` (and therefore not
#   here): it has no shell linter entry, so it falls through to the
#   ``ext not in LINTERS`` skip case unchanged.  Pre-PR behavior:
#   ``.tsx`` was implicitly ``skipped``.  Keeping it that way means
#   ``.tsx`` edits with LSP disabled get no per-file syntax check
#   (same as before this PR) instead of the broken ``tsc`` invocation
#   that ``.ts`` used to get.  When LSP is enabled, ``.tsx`` is covered
#   by the LSP tier via ``_maybe_lsp_diagnostics`` exactly as ``.ts``.
#
# - ``.go``: ``go vet FILE.go`` fails outside a module / GOPATH with
#   "cannot find package" — already partially handled by
#   ``_LINTER_UNUSABLE_PATTERNS`` but only when the package error is the
#   ONLY output; mixed real+phantom output still leaks through.
#   ``gopls`` is the canonical replacement.
#
# When the LSP service is configured AND ``enabled_for(path)`` for this
# extension's file, ``_check_lint`` skips the shell linter for these
# extensions — the ``lsp_diagnostics`` channel carries the real signal.
# Everything else in ``LINTERS`` (Python ``py_compile``, ``node --check``)
# is fast, file-local, and correct, so it runs unconditionally.
_SHELL_LINTER_LSP_REDUNDANT = frozenset({'.ts', '.go'})


# Patterns that indicate the linter base command exists on PATH but
# couldn't actually run — e.g. ``npx tsc`` when tsc isn't installed in
# node_modules, or ``go vet`` outside a module.  When
# any of these substrings appears in the linter output, ``_check_lint``
# returns ``skipped`` instead of ``error`` so:
#
# 1. The write isn't flagged for a tooling problem the agent can't fix.
# 2. The LSP semantic tier still runs (it gates on success/skipped).
#
# Patterns are matched case-insensitively against linter stdout.
_LINTER_UNUSABLE_PATTERNS = {
    'npx': (
        # npx prints this banner when the package isn't installed locally
        # AND it can't auto-install (no internet, registry off, etc.) or
        # when the binary it tried to run is the wrong one.
        'this is not the tsc command you are looking for',
        # npx with --no-install resolution failures
        'could not determine executable to run',
        'not found in npm registry',
    ),
    'go': (
        # ``go vet`` on a file outside a module / GOPATH
        'cannot find package',
        'go: cannot find main module',
    ),
}


def _looks_like_linter_unusable(base_cmd: str, output: str) -> bool:
    """Return True iff ``output`` from ``base_cmd`` indicates the linter
    itself couldn't run (a tooling gap), as opposed to a real lint error
    in the file being checked.

    ``base_cmd`` is the first word of the linter command line (``npx``,
    ``go``, ...).  ``output`` is the stdout/stderr captured
    from running it.
    """
    patterns = _LINTER_UNUSABLE_PATTERNS.get(base_cmd)
    if not patterns:
        return False
    lower = output.lower()
    return any(p in lower for p in patterns)


def _lint_json_inproc(content: str) -> tuple[bool, str]:
    """In-process JSON syntax check.  Returns (ok, error_message)."""
    import json as _json
    try:
        _json.loads(content)
        return True, ""
    except _json.JSONDecodeError as e:
        return False, f"JSONDecodeError: {e.msg} (line {e.lineno}, column {e.colno})"
    except Exception as e:  # noqa: BLE001 — any parse failure is a lint failure
        return False, f"{type(e).__name__}: {e}"


def _lint_yaml_inproc(content: str) -> tuple[bool, str]:
    """In-process YAML syntax check.  Returns (ok, error_message).

    Skipped gracefully if PyYAML isn't installed — YAML parsing is optional.
    """
    try:
        import yaml as _yaml
    except ImportError:
        # PyYAML not available — skip silently, caller treats as no linter.
        return True, "__SKIP__"
    try:
        _yaml.safe_load(content)
        return True, ""
    except _yaml.YAMLError as e:
        return False, f"YAMLError: {e}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _lint_toml_inproc(content: str) -> tuple[bool, str]:
    """In-process TOML syntax check (stdlib tomllib, Python 3.11+)."""
    try:
        import tomllib as _toml
    except ImportError:
        # Pre-3.11 fallback via tomli, if installed.
        try:
            import tomli as _toml  # type: ignore[no-redef]
        except ImportError:
            return True, "__SKIP__"
    try:
        _toml.loads(content)
        return True, ""
    except Exception as e:  # tomllib raises TOMLDecodeError, a ValueError subclass
        return False, f"{type(e).__name__}: {e}"


def _lint_python_inproc(content: str) -> tuple[bool, str]:
    """In-process Python syntax check via ast.parse.

    Catches SyntaxError, IndentationError, and everything else the
    ast module rejects — matching py_compile's scope but with no
    subprocess overhead and no dependency on a ``python`` in PATH.
    """
    import ast as _ast
    try:
        _ast.parse(content)
        return True, ""
    except SyntaxError as e:
        loc = f" (line {e.lineno}, column {e.offset})" if e.lineno else ""
        return False, f"{type(e).__name__}: {e.msg}{loc}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


# In-process linters by file extension.  Preferred over shell linters when
# present — no subprocess overhead, microseconds per call.  Each callable
# takes file content (str) and returns (ok: bool, error: str).  An error
# string of ``"__SKIP__"`` signals the linter isn't available (missing
# dependency) and should be treated as "no linter".
LINTERS_INPROC = {
    '.py': _lint_python_inproc,
    '.json': _lint_json_inproc,
    '.yaml': _lint_yaml_inproc,
    '.yml': _lint_yaml_inproc,
    '.toml': _lint_toml_inproc,
}

# Max limits for read operations
MAX_LINES = 2000
MAX_LINE_LENGTH = 2000
MAX_FILE_SIZE = 50 * 1024  # 50KB
DEFAULT_READ_OFFSET = 1
DEFAULT_READ_LIMIT = 500
DEFAULT_SEARCH_OFFSET = 0
DEFAULT_SEARCH_LIMIT = 50


def _coerce_int(value: Any, default: int) -> int:
    """Best-effort integer coercion for tool pagination inputs."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_read_pagination(offset: Any = DEFAULT_READ_OFFSET,
                              limit: Any = DEFAULT_READ_LIMIT) -> tuple[int, int]:
    """Return safe read_file pagination bounds.

    Tool schemas declare minimum/maximum values, but not every caller or
    provider enforces schemas before dispatch. Clamp here so invalid values
    cannot leak into sed ranges like ``0,-1p``.

    The upper bound on ``limit`` comes from ``tool_output.max_lines`` in
    config.yaml (defaults to the module-level ``MAX_LINES`` constant).
    """
    from tools.tool_output_limits import get_max_lines
    max_lines = get_max_lines()
    normalized_offset = max(1, _coerce_int(offset, DEFAULT_READ_OFFSET))
    normalized_limit = _coerce_int(limit, DEFAULT_READ_LIMIT)
    normalized_limit = max(1, min(normalized_limit, max_lines))
    return normalized_offset, normalized_limit


def normalize_search_pagination(offset: Any = DEFAULT_SEARCH_OFFSET,
                                limit: Any = DEFAULT_SEARCH_LIMIT) -> tuple[int, int]:
    """Return safe search pagination bounds for shell head/tail pipelines."""
    normalized_offset = max(0, _coerce_int(offset, DEFAULT_SEARCH_OFFSET))
    normalized_limit = max(1, _coerce_int(limit, DEFAULT_SEARCH_LIMIT))
    return normalized_offset, normalized_limit


class ShellFileOperations(FileOperations):
    """
    File operations implemented via shell commands.
    
    Works with ANY terminal backend that has execute(command, cwd) method.
    This includes local, docker, singularity, ssh, modal, and daytona environments.
    """
    
    def __init__(self, terminal_env, cwd: str = None):
        """
        Initialize file operations with a terminal environment.

        Args:
            terminal_env: Any object with execute(command, cwd) method.
                         Returns {"output": str, "returncode": int}
            cwd: Optional explicit fallback cwd when the terminal env has
                 no cwd attribute (rare — most backends track cwd live).

        Note:
            Every _exec() call prefers the LIVE ``terminal_env.cwd`` over
            ``self.cwd`` so ``cd`` commands run via the terminal tool are
            picked up immediately.  ``self.cwd`` is only used as a fallback
            when the env has no cwd at all — it is NOT the authoritative
            cwd, despite being settable at init time.

            Historical bug (fixed): prior versions of this class used the
            init-time cwd for every _exec() call, which caused relative
            paths passed to patch/read/write to target the wrong directory
            after the user ran ``cd`` in the terminal.  Patches would
            claim success and return a plausible diff but land in the
            original directory, producing apparent silent failures.
        """
        self.env = terminal_env
        # Determine cwd from various possible sources.
        # IMPORTANT: do NOT fall back to os.getcwd() -- that's the HOST's local
        # path which doesn't exist inside container/cloud backends (modal, docker).
        # If nothing provides a cwd, use "/" as a safe universal default.
        self.cwd = cwd or getattr(terminal_env, 'cwd', None) or \
                   getattr(getattr(terminal_env, 'config', None), 'cwd', None) or "/"

        # Cache for command availability checks
        self._command_cache: Dict[str, bool] = {}
    
    def _exec(self, command: str, cwd: str = None, timeout: int = None,
              stdin_data: str = None) -> ExecuteResult:
        """Execute command via terminal backend.

        Args:
            stdin_data: If provided, piped to the process's stdin instead of
                        embedding in the command string. Bypasses ARG_MAX.

        Cwd resolution order (critical — see class docstring):
          1. Explicit ``cwd`` arg (if provided)
          2. Live ``self.env.cwd`` (tracks ``cd`` commands run via terminal)
          3. Init-time ``self.cwd`` (fallback when env has no cwd attribute)

        This ordering ensures relative paths in file operations follow the
        terminal's current directory — not the directory this file_ops was
        originally created in.  See test_file_ops_cwd_tracking.py.
        """
        kwargs = {}
        if timeout:
            kwargs['timeout'] = timeout
        if stdin_data is not None:
            kwargs['stdin_data'] = stdin_data

        # Resolve cwd from the live env so `cd` commands are picked up.
        # Fall through to init-time self.cwd only if the env doesn't track cwd.
        effective_cwd = cwd or getattr(self.env, 'cwd', None) or self.cwd
        result = self.env.execute(command, cwd=effective_cwd, **kwargs)
        return ExecuteResult(
            stdout=result.get("output", ""),
            exit_code=result.get("returncode", 0)
        )
    
    def _has_command(self, cmd: str) -> bool:
        """Check if a command exists in the environment (cached)."""
        if cmd not in self._command_cache:
            result = self._exec(f"command -v {cmd} >/dev/null 2>&1 && echo 'yes'")
            self._command_cache[cmd] = result.stdout.strip() == 'yes'
        return self._command_cache[cmd]
    
    def _is_likely_binary(self, path: str, content_sample: str = None) -> bool:
        """
        Check if a file is likely binary.
        
        Uses extension check (fast) + content analysis (fallback).
        """
        ext = os.path.splitext(path)[1].lower()
        if ext in BINARY_EXTENSIONS:
            return True
        
        # Content analysis: >30% non-printable chars = binary
        if content_sample:
            non_printable = sum(1 for c in content_sample[:1000]
                               if ord(c) < 32 and c not in '\n\r\t')
            return non_printable / min(len(content_sample), 1000) > 0.30
        
        return False
    
    def _is_image(self, path: str) -> bool:
        """Check if file is an image we can return as base64."""
        ext = os.path.splitext(path)[1].lower()
        return ext in IMAGE_EXTENSIONS
    
    def _add_line_numbers(self, content: str, start_line: int = 1) -> str:
        """Add line numbers to content in ``LINE_NUM|CONTENT`` format.

        The gutter uses a compact ``<n>|`` prefix (e.g. ``34|foo``) rather
        than a fixed-width zero/space-padded one (``    34|foo``). The
        padding was pure token overhead: on dense source the padded gutter
        cost ~48% more tokens than the bare content and ~16% more than the
        compact form, because the leading spaces + zero-padding tokenize
        into extra tokens on every single line. An A/B (Sonnet 4.6, 2
        passes) showed the compact gutter matches the padded gutter on
        line-reference / patch / value-lookup / structure tasks (4/4 both),
        while dropping line numbers entirely regressed line-referencing
        (the model hand-counted and was off-by-one, 3/4) — so we keep the
        numbers, just not the padding.
        """
        from tools.tool_output_limits import get_max_line_length
        max_line_length = get_max_line_length()
        lines = content.split('\n')
        numbered = []
        for i, line in enumerate(lines, start=start_line):
            # Truncate long lines
            if len(line) > max_line_length:
                line = line[:max_line_length] + "... [truncated]"
            numbered.append(f"{i}|{line}")
        return '\n'.join(numbered)
    
    def _expand_path(self, path: str) -> str:
        """
        Expand shell-style paths like ~ and ~user to absolute paths.
        
        This must be done BEFORE shell escaping, since ~ doesn't expand
        inside single quotes.
        """
        if not path:
            return path
        
        # Handle ~ and ~user
        if path.startswith('~'):
            # Get home directory via the terminal environment
            result = self._exec("echo $HOME")
            if result.exit_code == 0 and result.stdout.strip():
                home = result.stdout.strip()
                if path == '~':
                    return home
                elif path.startswith('~/'):
                    return home + path[1:]  # Replace ~ with home
                # ~username format - extract and validate username before
                # letting shell expand it (prevent shell injection via
                # paths like "~; rm -rf /").
                rest = path[1:]  # strip leading ~
                slash_idx = rest.find('/')
                username = rest[:slash_idx] if slash_idx >= 0 else rest
                if username and re.fullmatch(r'[a-zA-Z0-9._-]+', username):
                    # Only expand ~username (not the full path) to avoid shell
                    # injection via path suffixes like "~user/$(malicious)".
                    expand_result = self._exec(f"echo ~{username}")
                    if expand_result.exit_code == 0 and expand_result.stdout.strip():
                        user_home = expand_result.stdout.strip()
                        suffix = path[1 + len(username):]  # e.g. "/rest/of/path"
                        return user_home + suffix
        
        return path
    
    def _escape_shell_arg(self, arg: str) -> str:
        """Escape a string for safe use in shell commands."""
        # Use single quotes and escape any single quotes in the string
        return "'" + arg.replace("'", "'\"'\"'") + "'"

    def _atomic_write(self, path: str, content: str) -> "ExecuteResult":
        """Write ``content`` to ``path`` atomically via temp-file + rename.

        Streams ``content`` over stdin into a temp file in the SAME
        directory as ``path`` (so the final ``mv`` is a real rename on the
        same filesystem, not a non-atomic cross-device copy), preserves the
        existing file's mode if it exists, then renames over the target.
        On any failure the temp file is removed so we never leak a partial
        ``.autolycus-tmp`` file next to the user's data, and the original file
        is left untouched. Content rides stdin so there is no ARG_MAX limit.

        Returns an :class:`ExecuteResult`; ``exit_code == 0`` means the file
        was swapped into place atomically. A non-zero exit means nothing was
        renamed and the original (if any) is intact.
        """
        q_path = self._escape_shell_arg(path)
        parent = os.path.dirname(path) or "."
        q_parent = self._escape_shell_arg(parent)
        # template basename: hidden so it doesn't show up in casual `ls`,
        # carries a marker so an orphaned temp (only possible on a hard
        # crash *between* cat and mv) is identifiable.
        tmpl = self._escape_shell_arg(".autolycus-tmp.XXXXXX")

        # One shell script, fully quoted. Notes:
        #  - `mktemp` lands the temp in the target's own dir (-p) so `mv` is
        #    same-FS atomic; we fall back to a PID-stamped name if the
        #    backend lacks mktemp (rare; busybox/macOS/Linux all ship it).
        #  - `chmod --reference` is GNU-only, so we read the octal mode with
        #    `stat` (GNU `-c%a` or BSD `-f%Lp`) and `chmod` it explicitly;
        #    silent best-effort — a perms-copy failure must not abort the
        #    write, the file still lands with default umask perms.
        #  - `trap ... EXIT` guarantees the temp is removed on every error
        #    path (cat failure, mv failure, signal) but NOT after a
        #    successful mv (the temp no longer exists by then).
        #  - we `cat >` the temp, then `mv -f` it over the target.
        script = (
            "set -e; "
            f"d={q_parent}; t={q_path}; "
            'tmp="$(mktemp -p "$d" ' + tmpl + ' 2>/dev/null '
            '|| mktemp "$d/.autolycus-tmp.$$.XXXXXX" 2>/dev/null '
            '|| { tmp="$d/.autolycus-tmp.$$"; : > "$tmp" && echo "$tmp"; })"; '
            '[ -n "$tmp" ] || { echo "atomic write: could not create temp file" >&2; exit 1; }; '
            "trap 'rm -f \"$tmp\"' EXIT; "
            # preserve mode of an existing target (best-effort, never fatal)
            'if [ -e "$t" ]; then '
            'm="$(stat -c%a "$t" 2>/dev/null || stat -f%Lp "$t" 2>/dev/null || true)"; '
            '[ -n "$m" ] && chmod "$m" "$tmp" 2>/dev/null || true; '
            "fi; "
            'cat > "$tmp"; '
            'mv -f "$tmp" "$t"; '
            "trap - EXIT"
        )
        return self._exec(script, stdin_data=content)

    def _detect_file_line_ending(self, path: str, pre_content: Optional[str] = None) -> Optional[str]:
        """Detect the dominant line ending of a file on disk.

        If ``pre_content`` is already available (we just read the file
        for lint/LSP purposes), inspect that — zero extra exec calls.
        Otherwise issue a tiny ``head -c 4096`` to sample the first 4KB.

        Returns ``"\\r\\n"`` for CRLF (Windows), ``"\\n"`` for LF (Unix),
        or ``None`` if undetermined (new file, empty file, single-line
        file with no line break in the first chunk).
        """
        if pre_content:
            return _detect_line_ending(pre_content)
        # File may not exist (new write) — `head` exits 0 with empty
        # stdout in that case which yields None below.  Cheap probe.
        head_cmd = f"head -c 4096 {self._escape_shell_arg(path)} 2>/dev/null"
        head_result = self._exec(head_cmd)
        if head_result.exit_code != 0 or not head_result.stdout:
            return None
        return _detect_line_ending(head_result.stdout)

    def _file_has_bom(self, path: str, pre_content: Optional[str] = None) -> bool:
        """Whether the file on disk starts with a UTF-8 BOM.

        Uses ``pre_content`` if we already read the file (zero extra exec
        calls); otherwise issues a tiny ``head -c 3`` to sample just the
        marker. A missing/empty file returns False (new writes get no BOM
        unless the caller explicitly includes one).
        """
        if pre_content is not None:
            return _has_bom(pre_content)
        head_cmd = f"head -c 3 {self._escape_shell_arg(path)} 2>/dev/null"
        head_result = self._exec(head_cmd)
        if head_result.exit_code != 0 or not head_result.stdout:
            return False
        return _has_bom(head_result.stdout)


    def _unified_diff(self, old_content: str, new_content: str, filename: str) -> str:
        """Generate unified diff between old and new content."""
        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff = difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{filename}",
            tofile=f"b/{filename}"
        )
        return ''.join(diff)
    
    # =========================================================================
    # READ Implementation
    # =========================================================================
    
    def read_file(self, path: str, offset: int = 1, limit: int = 500) -> ReadResult:
        """
        Read a file with pagination, binary detection, and line numbers.
        
        Args:
            path: File path (absolute or relative to cwd)
            offset: Line number to start from (1-indexed, default 1)
            limit: Maximum lines to return (default 500, max 2000)
        
        Returns:
            ReadResult with content, metadata, or error info
        """
        # Expand ~ and other shell paths
        path = self._expand_path(path)
        
        offset, limit = normalize_read_pagination(offset, limit)
        
        # Check if file exists and get size (wc -c is POSIX, works on Linux + macOS)
        stat_cmd = f"wc -c < {self._escape_shell_arg(path)} 2>/dev/null"
        stat_result = self._exec(stat_cmd)
        
        if stat_result.exit_code != 0:
            # File not found - try to suggest similar files
            return self._suggest_similar_files(path)
        
        stat_output = _strip_terminal_fence_leaks(stat_result.stdout)
        try:
            file_size = int(stat_output.strip())
        except ValueError:
            file_size = 0
        
        # Check if file is too large
        if file_size > MAX_FILE_SIZE:
            # Still try to read, but warn
            pass
        
        # Images are never inlined — redirect to the vision tool
        if self._is_image(path):
            return ReadResult(
                is_image=True,
                is_binary=True,
                file_size=file_size,
                hint=(
                    "Image file detected. Automatically redirected to vision_analyze tool. "
                    "Use vision_analyze with this file path to inspect the image contents."
                ),
            )
        
        # Read a sample to check for binary content
        sample_cmd = f"head -c 1000 {self._escape_shell_arg(path)} 2>/dev/null"
        sample_result = self._exec(sample_cmd)
        sample_output = _strip_terminal_fence_leaks(sample_result.stdout)
        
        if self._is_likely_binary(path, sample_output):
            return ReadResult(
                is_binary=True,
                file_size=file_size,
                error="Binary file - cannot display as text. Use appropriate tools to handle this file type."
            )
        
        # Read with pagination using sed
        end_line = offset + limit - 1
        read_cmd = f"sed -n '{offset},{end_line}p' {self._escape_shell_arg(path)}"
        read_result = self._exec(read_cmd)
        
        if read_result.exit_code != 0:
            return ReadResult(error=f"Failed to read file: {read_result.stdout}")
        read_output = _strip_terminal_fence_leaks(read_result.stdout)
        # Strip a leading UTF-8 BOM so the model never sees a phantom U+FEFF
        # before the first real character. Only meaningful on the first
        # chunk (the marker lives at byte 0); later pages can't carry it.
        if offset == 1:
            read_output, _ = _strip_bom(read_output)
        
        # Get total line count
        wc_cmd = f"wc -l < {self._escape_shell_arg(path)}"
        wc_result = self._exec(wc_cmd)
        wc_output = _strip_terminal_fence_leaks(wc_result.stdout)
        try:
            total_lines = int(wc_output.strip())
        except ValueError:
            total_lines = 0
        
        # Check if truncated
        truncated = total_lines > end_line
        hint = None
        if truncated:
            hint = f"Use offset={end_line + 1} to continue reading (showing {offset}-{end_line} of {total_lines} lines)"
        
        return ReadResult(
            content=self._add_line_numbers(read_output, offset),
            total_lines=total_lines,
            file_size=file_size,
            truncated=truncated,
            hint=hint
        )
    
    def _suggest_similar_files(self, path: str) -> ReadResult:
        """Suggest similar files when the requested file is not found."""
        dir_path = os.path.dirname(path) or "."
        filename = os.path.basename(path)
        basename_no_ext = os.path.splitext(filename)[0]
        ext = os.path.splitext(filename)[1].lower()
        lower_name = filename.lower()

        # List files in the target directory
        ls_cmd = f"ls -1 {self._escape_shell_arg(dir_path)} 2>/dev/null | head -50"
        ls_result = self._exec(ls_cmd)

        scored: list = []  # (score, filepath) — higher is better
        if ls_result.exit_code == 0 and ls_result.stdout.strip():
            for f in ls_result.stdout.strip().split('\n'):
                if not f:
                    continue
                lf = f.lower()
                score = 0

                # Exact match (shouldn't happen, but guard)
                if lf == lower_name:
                    score = 100
                # Same base name, different extension (e.g. config.yml vs config.yaml)
                elif os.path.splitext(f)[0].lower() == basename_no_ext.lower():
                    score = 90
                # Target is prefix of candidate or vice-versa
                elif lf.startswith(lower_name) or lower_name.startswith(lf):
                    score = 70
                # Substring match (candidate contains query)
                elif lower_name in lf:
                    score = 60
                # Reverse substring (query contains candidate name)
                elif lf in lower_name