"""Tests for lycus_cli.managed_uv — one path, no guessing."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_executable(path: Path) -> None:
    """Create a minimal fake uv binary at *path*."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\necho uv 0.1.2\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


# ---------------------------------------------------------------------------
# managed_uv_path
# ---------------------------------------------------------------------------

class TestManagedUvPath:
    def test_posix(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.platform.system", return_value="Linux"):
            from lycus_cli.managed_uv import managed_uv_path
            assert managed_uv_path() == tmp_path / "bin" / "uv"

    def test_windows(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.platform.system", return_value="Windows"):
            from lycus_cli.managed_uv import managed_uv_path
            assert managed_uv_path() == tmp_path / "bin" / "uv.exe"


# ---------------------------------------------------------------------------
# resolve_uv
# ---------------------------------------------------------------------------

class TestResolveUv:
    def test_missing_returns_none(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path):
            from lycus_cli.managed_uv import resolve_uv
            assert resolve_uv() is None

    def test_existing_executable(self, tmp_path):
        _make_executable(tmp_path / "bin" / "uv")
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path):
            from lycus_cli.managed_uv import resolve_uv
            result = resolve_uv()
            assert result == str(tmp_path / "bin" / "uv")

    def test_non_executable_file_returns_none(self, tmp_path):
        uv = tmp_path / "bin" / "uv"
        uv.parent.mkdir(parents=True)
        uv.write_text("not a binary")
        # Ensure no execute bit
        uv.chmod(0o644)
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path):
            from lycus_cli.managed_uv import resolve_uv
            assert resolve_uv() is None


# ---------------------------------------------------------------------------
# ensure_uv
# ---------------------------------------------------------------------------

class TestEnsureUv:
    def test_already_installed_no_bootstrap(self, tmp_path):
        _make_executable(tmp_path / "bin" / "uv")
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path):
            from lycus_cli.managed_uv import ensure_uv
            path = ensure_uv()
            assert path == str(tmp_path / "bin" / "uv")

    def test_installs_if_missing(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv._install_uv") as mock_install:
            # Simulate the installer creating the binary
            def fake_install(target):
                _make_executable(target)
            mock_install.side_effect = fake_install

            from lycus_cli.managed_uv import ensure_uv
            path = ensure_uv()
            assert path == str(tmp_path / "bin" / "uv")
            mock_install.assert_called_once()

    def test_install_failure_returns_falsy(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv._install_uv", side_effect=RuntimeError("network down")):
            from lycus_cli.managed_uv import ensure_uv
            path = ensure_uv()
            assert path is None
            assert fresh is False


# ---------------------------------------------------------------------------
# rebuild_venv
# ---------------------------------------------------------------------------

class TestRebuildVenv:
    def test_moves_old_venv_aside_and_creates_new(self, tmp_path):
        """The old venv is moved aside to <venv>.old (never rmtree'd in place),
        uv is invoked with --clear, the moved-aside backup is removed on
        success, and the rebuilt interpreter is reported."""
        venv_dir = tmp_path / "venv"
        venv_dir.mkdir()
        (venv_dir / "old_file").write_text("stale")

        uv_bin = str(tmp_path / "bin" / "uv")
        call_log: list[list[str]] = []

        def fake_run(cmd, **kwargs):
            call_log.append(list(cmd))
            m = MagicMock(returncode=0, stderr="", stdout="")
            if len(cmd) >= 2 and cmd[1] == "venv":
                # Simulate uv creating the venv dir with a python interpreter
                bin_dir = venv_dir / ("Scripts" if os.name == "nt" else "bin")
                bin_dir.mkdir(parents=True, exist_ok=True)
                python_name = "python.exe" if os.name == "nt" else "python"
                (bin_dir / python_name).write_text("#!/bin/sh\necho Python 3.11.0")
            elif "--version" in cmd:
                m.stdout = "Python 3.11.0"
            return m

        with patch("lycus_cli.managed_uv.subprocess.run", side_effect=fake_run):
            from lycus_cli.managed_uv import rebuild_venv
            result = rebuild_venv(uv_bin, venv_dir)

        assert result is True
        # uv venv was invoked exactly once, always with --clear.
        venv_calls = [c for c in call_log if len(c) >= 2 and c[1] == "venv"]
        assert len(venv_calls) == 1, f"expected 1 venv call, got {venv_calls}"
        assert "--clear" in venv_calls[0]
        # The moved-aside backup is cleaned up after a successful rebuild.
        assert not (tmp_path / "venv.old").exists()

    def test_aborts_without_deleting_when_venv_in_use(self, tmp_path):
        """If os.replace fails (Windows file lock — venv in use), we must abort
        cleanly WITHOUT deleting the venv and WITHOUT invoking uv."""
        venv_dir = tmp_path / "venv"
        venv_dir.mkdir()
        (venv_dir / "locked") .write_text("held open")
        uv_bin = str(tmp_path / "bin" / "uv")
        call_log: list[list[str]] = []

        def fake_run(cmd, **kwargs):
            call_log.append(list(cmd))
            return MagicMock(returncode=0, stderr="", stdout="")

        with patch("lycus_cli.managed_uv.subprocess.run", side_effect=fake_run), \
             patch("lycus_cli.managed_uv.os.replace", side_effect=OSError("in use")):
            from lycus_cli.managed_uv import rebuild_venv
            result = rebuild_venv(uv_bin, venv_dir)

        assert result is False
        # venv left fully intact, uv never invoked.
        assert venv_dir.exists() and (venv_dir / "locked").exists()
        assert [c for c in call_log if len(c) >= 2 and c[1] == "venv"] == []

    def test_restores_backup_when_rebuild_fails(self, tmp_path):
        """If uv venv exits non-zero, the moved-aside venv is restored so we
        never leave Lycus with no venv at all."""
        venv_dir = tmp_path / "venv"
        venv_dir.mkdir()
        (venv_dir / "marker").write_text("original")
        uv_bin = str(tmp_path / "bin" / "uv")

        def fake_run(cmd, **kwargs):
            return MagicMock(returncode=1, stderr="boom", stdout="")

        with patch("lycus_cli.managed_uv.subprocess.run", side_effect=fake_run):
            from lycus_cli.managed_uv import rebuild_venv
            result = rebuild_venv(uv_bin, venv_dir)

        assert result is False
        # Original venv restored from the .old backup.
        assert venv_dir.exists() and (venv_dir / "marker").read_text() == "original"
        assert not (tmp_path / "venv.old").exists()

    def test_rebuild_failure_returns_false(self, tmp_path):
        venv_dir = tmp_path / "venv"
        uv_bin = str(tmp_path / "bin" / "uv")

        with patch("lycus_cli.managed_uv.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr="nope")
            from lycus_cli.managed_uv import rebuild_venv
            result = rebuild_venv(uv_bin, venv_dir)
            assert result is False

    def test_retries_with_clear_when_dir_already_exists(self, tmp_path):
        """On Windows, rmtree can silently fail when an open handle holds a
        file in the venv (running lycus.exe, gateway, AV scanner). uv then
        refuses with ``Caused by: A directory already exists at: venv``.
        Make sure we don't give up — retry with ``--clear`` to force uv past
        the stale directory and rebuild successfully."""
        venv_dir = tmp_path / "venv"
        venv_dir.mkdir()
        (venv_dir / "stale_open_handle").write_text("rmtree couldn't delete me")

        uv_bin = str(tmp_path / "bin" / "uv")
        call_log: list[list[str]] = []

        def fake_run(cmd, **kwargs):
            call_log.append(list(cmd))
            m = MagicMock()
            if cmd[1] == "venv" and "--clear" not in cmd:
                # First attempt: uv refuses because dir still exists
                m.returncode = 1
                m.stderr = (
                    "error: Failed to create virtual environment\n"
                    "  Caused by: A directory already exists at: venv\n"
                    "hint: Use the `--clear` flag or set `UV_VENV_CLEAR=1` to replace the existing directory\n"
                )
                m.stdout = ""
                return m
            if cmd[1] == "venv" and "--clear" in cmd:
                # Retry: succeeds. Simulate uv writing the python shim.
                m.returncode = 0
                m.stderr = ""
                m.stdout = ""
                bin_dir = venv_dir / ("Scripts" if os.name == "nt" else "bin")
                bin_dir.mkdir(parents=True, exist_ok=True)
                python_name = "python.exe" if os.name == "nt" else "python"
                (bin_dir / python_name).write_text("#!/bin/sh\necho Python 3.11.0")
                return m
            if "--version" in cmd:
                m.returncode = 0
                m.stdout = "Python 3.11.0"
                m.stderr = ""
                return m
            m.returncode = 0
            return m

        with patch("lycus_cli.managed_uv.subprocess.run", side_effect=fake_run), \
             patch("lycus_cli.managed_uv.shutil.rmtree"):
            from lycus_cli.managed_uv import rebuild_venv
            result = rebuild_venv(uv_bin, venv_dir)

        assert result is True, "rebuild should succeed after --clear retry"
        # We expect exactly two ``uv venv`` calls: one without --clear, one with.
        venv_calls = [c for c in call_log if len(c) >= 2 and c[1] == "venv"]
        assert len(venv_calls) == 2, f"expected 2 venv calls, got {venv_calls}"
        assert "--clear" not in venv_calls[0], "first call should not pass --clear"
        assert "--clear" in venv_calls[1], "retry must pass --clear"

    def test_does_not_retry_when_first_failure_is_not_dir_exists(self, tmp_path):
        """If uv venv fails for some other reason (e.g. interpreter download
        failed, disk full), we should NOT silently retry with --clear —
        that would mask a real problem. Just surface the original failure."""
        venv_dir = tmp_path / "venv"
        uv_bin = str(tmp_path / "bin" / "uv")
        call_log: list[list[str]] = []

        def fake_run(cmd, **kwargs):
            call_log.append(list(cmd))
            m = MagicMock(returncode=1, stderr="error: No space left on device", stdout="")
            return m

        with patch("lycus_cli.managed_uv.subprocess.run", side_effect=fake_run), \
             patch("lycus_cli.managed_uv.shutil.rmtree"):
            from lycus_cli.managed_uv import rebuild_venv
            result = rebuild_venv(uv_bin, venv_dir)

        assert result is False
        venv_calls = [c for c in call_log if len(c) >= 2 and c[1] == "venv"]
        assert len(venv_calls) == 1, "should not retry on non-dir-exists failures"
        assert "--clear" not in venv_calls[0]
    def test_rebuild_success_without_python_returns_false(self, tmp_path):
        """uv can exit 0 yet leave no interpreter; that must not count as success
        (guard adapted from #38511)."""
        venv_dir = tmp_path / "venv"
        uv_bin = str(tmp_path / "bin" / "uv")

        with patch("lycus_cli.managed_uv.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            from lycus_cli.managed_uv import rebuild_venv
            result = rebuild_venv(uv_bin, venv_dir)
            assert result is False
            # Returned before the `python --version` probe ran (only the uv venv call).
            assert mock_run.call_count == 1
            # Failure is a falsy sentinel (not None) so legacy 2-target call
            # sites can still unpack it without raising — see
            # TestEnsureUvUpdateBoundary for why.
            assert not path


class TestEnsureUvUpdateBoundary:
    """``ensure_uv()`` must answer to both the single-value and the legacy
    ``(path, fresh_bootstrap)`` call conventions — **on POSIX**.

    ``lycus update`` runs the call site from the old, already-imported
    ``lycus_cli.main`` against the freshly pulled ``managed_uv``. A release
    parked on a ``(path, fresh)`` tuple runs ``uv_bin, fresh = ensure_uv()``
    against the single-value module; the path is an iterable ``str`` so the
    2-target unpack walked its characters and raised
    ``ValueError: too many values to unpack (expected 2)`` (root cause behind
    PR #39763), or ``TypeError`` on the ``None`` failure path. On POSIX the
    result must therefore be usable as a bare path *and* unpackable as a
    2-tuple, in both the success and failure cases.

    The dual contract is intentionally **not** offered on Windows — see
    ``TestEnsureUvWindowsSafe`` for why — so these tests pin ``platform.system``
    to a POSIX value.
    """

    def test_success_usable_as_single_value(self, tmp_path):
        _make_executable(tmp_path / "bin" / "uv")
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.platform.system", return_value="Linux"):
            from lycus_cli.managed_uv import ensure_uv
            uv_bin = ensure_uv()
            assert uv_bin == str(tmp_path / "bin" / "uv")
            assert bool(uv_bin) is True

    def test_success_unpacks_as_legacy_two_tuple(self, tmp_path):
        _make_executable(tmp_path / "bin" / "uv")
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.platform.system", return_value="Linux"):
            from lycus_cli.managed_uv import ensure_uv
            uv_bin, fresh = ensure_uv()  # old: uv_bin, fresh_bootstrap = ensure_uv()
            assert uv_bin == str(tmp_path / "bin" / "uv")
            assert fresh is False

    def test_failure_unpacks_without_raising(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.platform.system", return_value="Linux"), \
             patch("lycus_cli.managed_uv._install_uv", side_effect=RuntimeError("network down")):
            from lycus_cli.managed_uv import ensure_uv
            uv_bin, fresh = ensure_uv()
            assert uv_bin is None
            assert fresh is False


class TestEnsureUvWindowsSafe:
    """On Windows ``ensure_uv()`` must return a plain ``str``/``None``.

    ``subprocess`` on Windows serializes argv through
    ``subprocess.list2cmdline``, which iterates every entry *as a string*
    (``for c in arg``). The dependency installer feeds uv straight into the
    command list (``[uv_bin, "pip", "install", ...]``). A ``str`` subclass
    whose ``__iter__`` yields ``(path, fresh_bootstrap)`` instead of characters
    therefore injects the bool into the command line and crashes the install
    with ``TypeError: sequence item 1: expected str instance, bool found``
    (a real field report on a 10-commits-behind Windows install). A single
    return value cannot serve both the legacy 2-tuple unpack and Windows
    char-iteration — both use the iterator protocol — so Windows opts out of
    the wrapper entirely.
    """

    def test_uvresult_would_break_windows_list2cmdline(self):
        # Canary: this is *why* the wrapper is gated off Windows. If a future
        # change makes _UvResult char-iterable (and thus list2cmdline-safe),
        # the gate may be revisited.
        import subprocess
        from lycus_cli.managed_uv import _UvResult
        with pytest.raises(TypeError):
            subprocess.list2cmdline([_UvResult("C:\\lycus\\uv.exe"), "pip"])

    def test_windows_returns_plain_str_safe_for_subprocess(self, tmp_path):
        import subprocess
        # On (mocked) Windows the managed binary is uv.exe.
        _make_executable(tmp_path / "bin" / "uv.exe")
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.platform.system", return_value="Windows"):
            from lycus_cli.managed_uv import _UvResult, ensure_uv
            uv_bin = ensure_uv()
            assert type(uv_bin) is str and not isinstance(uv_bin, _UvResult)
            # The exact operation that crashed in the field must now succeed.
            cmdline = subprocess.list2cmdline([uv_bin, "pip", "install", "-e", "."])
            assert "pip" in cmdline and "install" in cmdline

    def test_windows_failure_returns_none(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.platform.system", return_value="Windows"), \
             patch("lycus_cli.managed_uv._install_uv", side_effect=RuntimeError("network down")):
            from lycus_cli.managed_uv import ensure_uv
            assert ensure_uv() is None


# ---------------------------------------------------------------------------
# update_managed_uv
# ---------------------------------------------------------------------------

class TestUpdateManagedUv:
    def test_no_uv_returns_none(self, tmp_path):
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path):
            from lycus_cli.managed_uv import update_managed_uv
            assert update_managed_uv() is None

    def test_self_update_success(self, tmp_path):
        _make_executable(tmp_path / "bin" / "uv")
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.subprocess.run") as mock_run:
            # uv self update succeeds
            mock_run.return_value = MagicMock(returncode=0, stdout="uv 0.2.0")
            from lycus_cli.managed_uv import update_managed_uv
            result = update_managed_uv()
            assert result == str(tmp_path / "bin" / "uv")
            # First call is self update, second is --version
            assert mock_run.call_count == 2
            assert mock_run.call_args_list[0][0][0] == [str(tmp_path / "bin" / "uv"), "self", "update"]

    def test_self_update_failure_non_fatal(self, tmp_path):
        _make_executable(tmp_path / "bin" / "uv")
        with patch("lycus_cli.managed_uv.get_lycus_home", return_value=tmp_path), \
             patch("lycus_cli.managed_uv.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr="nope")
            from lycus_cli.managed_uv import update_managed_uv
            result = update_managed_uv()
            # Still returns the path — failure is non-fatal
            assert result == str(tmp_path / "bin" / "uv")


# ---------------------------------------------------------------------------
# _install_uv internals
# ---------------------------------------------------------------------------

class TestInstallUvInternals:
    def test_posix_sets_uv_unmanaged_install(self, tmp_path):
        target = tmp_path / "bin" / "uv"
        with patch("lycus_cli.managed_uv._install_uv_posix") as mock_posix:
            from lycus_cli.managed_uv import _install_uv
            _install_uv(target)
            mock_posix.assert_called_once()
            call_env = mock_posix.call_args[0][0]
            assert call_env["UV_UNMANAGED_INSTALL"] == str(tmp_path / "bin")

    def test_windows_sets_uv_install_dir(self, tmp_path):
        target = tmp_path / "bin" / "uv.exe"
        with patch("lycus_cli.managed_uv.platform.system", return_value="Windows"), \
             patch("lycus_cli.managed_uv._install_uv_windows") as mock_windows:
            from lycus_cli.managed_uv import _install_uv
            _install_uv(target)
            mock_windows.assert_called_once()
            call_env = mock_windows.call_args[0][0]
            assert call_env["UV_INSTALL_DIR"] == str(tmp_path / "bin")
