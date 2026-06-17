"""Tests for the container-context sandbox-mirror guard (#32049 follow-up).

Brian's shape-based guard (#32213) catches paths that carry the full
``…/sandboxes/<backend>/<task>/home/.autolycus/…`` prefix. This covers the
complementary inner-container case: when file tools execute inside Docker,
the bind-mount strips that prefix and the guard sees plain ``/root/.autolycus/…``.
The root:root ownership on the divergent SOUL.md in #32049 confirms this
is the primary failure mode.
"""
from __future__ import annotations

import pytest


class TestClassifyContainerMirrorTarget:
    def test_returns_none_without_context(self):
        """No Docker context — /root/.autolycus/… must not be flagged."""
        from agent.file_safety import classify_container_mirror_target

        assert classify_container_mirror_target("/root/.autolycus/profiles/group1/SOUL.md") is None

    def test_catches_soul_md_with_context(self):
        """Primary failure mode from #32049: agent writes SOUL.md via container path."""
        from agent.file_safety import classify_container_mirror_target

        result = classify_container_mirror_target(
            "/root/.autolycus/profiles/group1/SOUL.md",
            mirror_prefix="/root/.autolycus",
        )
        assert result is not None
        assert result["mirror_root"].replace("\\", "/").endswith("root/.autolycus")
        assert result["inner_path"] == "profiles/group1/SOUL.md"

    @pytest.mark.parametrize("inner", [
        "SOUL.md",
        "memories/MEMORY.md",
    ])
    def test_catches_authoritative_profile_files(self, inner):
        from agent.file_safety import classify_container_mirror_target

        result = classify_container_mirror_target(
            f"/root/.autolycus/{inner}",
            mirror_prefix="/root/.autolycus",
        )
        assert result is not None
        assert result["inner_path"] == inner

    def test_non_lycus_path_not_flagged(self):
        """/root/workspace/… is not .autolycus state and must not be blocked."""
        from agent.file_safety import classify_container_mirror_target

        assert (
            classify_container_mirror_target(
                "/root/workspace/main.py",
                mirror_prefix="/root/.autolycus",
            )
            is None
        )


class TestGetContainerMirrorWarning:
    def test_warning_names_inner_path_and_bypass(self):
        from agent.file_safety import get_container_mirror_warning

        warn = get_container_mirror_warning(
            "/root/.autolycus/profiles/group1/SOUL.md",
            mirror_prefix="/root/.autolycus",
        )
        assert warn is not None
        assert "profiles/group1/SOUL.md" in warn
        assert "cross_profile=True" in warn


class TestOrthogonality:
    """Container-context guard catches what the shape-based guard (#32213) misses."""

    def test_inner_container_path_caught_by_context_guard(self):
        """No sandboxes/ segment — shape guard passes, context guard blocks."""
        from agent.file_safety import classify_container_mirror_target

        path = "/root/.autolycus/profiles/group1/SOUL.md"

        assert classify_container_mirror_target(path) is None  # no context
        assert classify_container_mirror_target(path, mirror_prefix="/root/.autolycus") is not None


class TestFileToolIntegration:
    """file_tools must catch the mirror path before creating DockerEnvironment."""

    def test_guard_uses_current_docker_config_before_env_exists(self, monkeypatch):
        import tools.file_tools as file_tools

        monkeypatch.setattr(
            file_tools,
            "_get_container_mirror_prefix_for_task",
            lambda task_id: "/root/.autolycus",
        )

        warning = file_tools._check_cross_profile_path(
            "/root/.autolycus/profiles/group1/SOUL.md",
            task_id="new-task",
        )

        assert warning is not None
        assert "Sandbox-mirror write blocked" in warning
        assert "profiles/group1/SOUL.md" in warning
