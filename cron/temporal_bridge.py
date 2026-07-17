"""Temporal workflow orchestration bridge for Lycus cron jobs.

Replaces the file-based tick() scheduler with Temporal durable workflows.
Each scheduled job becomes a Temporal Workflow + Activity pair, managed by
Temporal's built-in scheduling instead of a polling loop.

Architecture:
  - CronJobWorkflow: Orchestrates one execution cycle (execute → save → deliver)
  - Activities: execute_cron_job, save_cron_output, deliver_cron_result
  - Bridge: Manages Temporal client, schedules, and graceful fallback to tick()

Fallback behaviour:
  If Temporal is unavailable at any point, the bridge falls back to the existing
  file-based scheduler (tick()). Job definitions remain in jobs.json regardless.

Self-contained: this module handles job storage directly via jobs.json and
execution directly, without importing from cron.jobs or cron.scheduler.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

# ---------------------------------------------------------------------------
# Temporal imports — guarded so the module loads even without temporalio
# ---------------------------------------------------------------------------
try:
    from temporalio import activity, workflow
    from temporalio.client import (
        Client as TemporalClient,
        Schedule,
        ScheduleActionStartWorkflow,
        ScheduleCalendarSpec,
        ScheduleIntervalSpec,
        ScheduleOverlapPolicy,
        SchedulePolicy,
        ScheduleRange,
        ScheduleSpec,
        ScheduleUpdate,
        UpdateScheduleInput,
    )
    from temporalio.common import RetryPolicy
    from temporalio.worker import Worker as TemporalWorker
    HAS_TEMPORAL = True
except ImportError:
    HAS_TEMPORAL = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TEMPORAL_TASK_QUEUE = "lycus-cron"
TEMPORAL_NAMESPACE = os.getenv("LYCUS_TEMPORAL_NAMESPACE", "default")
TEMPORAL_HOST = os.getenv("LYCUS_TEMPORAL_HOST", "127.0.0.1")
TEMPORAL_PORT = int(os.getenv("LYCUS_TEMPORAL_PORT", "7233"))

# Workflow-level timeouts
DEFAULT_EXECUTION_TIMEOUT = timedelta(hours=2)
DEFAULT_ACTIVITY_TIMEOUT = timedelta(minutes=15)
DEFAULT_HEARTBEAT_TIMEOUT = timedelta(seconds=30)

# Sentinel: when a cron agent has nothing new to report, it can start its
# response with this marker to suppress delivery.  Output is still saved
# locally for audit.
SILENT_MARKER = "[SILENT]"


# =============================================================================
# Self-contained jobs.json helpers
# =============================================================================
# These replace ALL imports from cron.jobs. The bridge reads/writes jobs.json
# directly without depending on the cron.jobs module.

# Add parent directory to path so lycus_time, lycus_constants, utils are
# importable — same pattern as scheduler.py.
_sys_path_added = False


def _ensure_sys_path():
    global _sys_path_added
    if not _sys_path_added:
        try:
            _parent = str(Path(__file__).parent.parent)
            if _parent not in sys.path:
                sys.path.insert(0, _parent)
            _sys_path_added = True
        except Exception:
            pass


def _lycus_now_local() -> datetime:
    """Return the current time as a timezone-aware datetime (self-contained)."""
    _ensure_sys_path()
    try:
        from lycus_time import now as _now
        return _now()
    except Exception:
        return datetime.now().astimezone()


# ---------------------------------------------------------------------------
# Paths and locking
# ---------------------------------------------------------------------------
def _get_cron_dir() -> Path:
    _ensure_sys_path()
    try:
        from lycus_constants import get_lycus_home
        return get_lycus_home().resolve() / "cron"
    except Exception:
        return Path.home() / ".autolycus" / "cron"


_CRON_DIR = _get_cron_dir()
_JOBS_FILE = _CRON_DIR / "jobs.json"
_OUTPUT_DIR = _CRON_DIR / "output"
_jobs_file_lock = threading.RLock()


def _ensure_dirs():
    """Ensure cron directories exist with secure permissions."""
    _CRON_DIR.mkdir(parents=True, exist_ok=True)
    _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(_CRON_DIR, 0o700)
        os.chmod(_OUTPUT_DIR, 0o700)
    except (OSError, NotImplementedError):
        pass


def _load_jobs() -> List[Dict[str, Any]]:
    """Load all jobs from jobs.json."""
    _ensure_dirs()
    if not _JOBS_FILE.exists():
        return []
    try:
        with open(_JOBS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError:
        try:
            with open(_JOBS_FILE, 'r', encoding='utf-8') as f:
                data = json.loads(f.read(), strict=False)
        except Exception as e:
            raise RuntimeError(f"Cron database corrupted: {e}") from e
    except IOError as e:
        raise RuntimeError(f"Failed to read cron database: {e}") from e

    if isinstance(data, dict):
        return data.get("jobs", [])
    if isinstance(data, list):
        return data
    raise RuntimeError(
        f"Cron database corrupted: expected dict or list, got {type(data).__name__}"
    )


def _save_jobs(jobs: List[Dict[str, Any]]):
    """Save all jobs to jobs.json. Caller must hold _jobs_file_lock."""
    _ensure_dirs()
    try:
        from utils import atomic_replace
    except ImportError:
        atomic_replace = None  # type: ignore

    fd, tmp_path = tempfile.mkstemp(
        dir=str(_JOBS_FILE.parent), suffix='.tmp', prefix='.jobs_'
    )
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump({"jobs": jobs, "updated_at": _lycus_now_local().isoformat()}, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        if atomic_replace:
            atomic_replace(tmp_path, _JOBS_FILE)
        else:
            os.replace(tmp_path, str(_JOBS_FILE))
        try:
            os.chmod(_JOBS_FILE, 0o600)
        except (OSError, NotImplementedError):
            pass
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _normalize_job_record(job: Dict[str, Any]) -> Dict[str, Any]:
    """Return a read-safe job record with normalized fields."""
    normalized = dict(job)

    # Normalize skills
    skills = normalized.get("skills")
    skill = normalized.get("skill")
    if skills is None:
        raw_items = [skill] if skill else []
    elif isinstance(skills, str):
        raw_items = [skills]
    else:
        raw_items = list(skills)
    normalized_skills: List[str] = []
    for item in raw_items:
        text = str(item or "").strip()
        if text and text not in normalized_skills:
            normalized_skills.append(text)
    normalized["skills"] = normalized_skills
    normalized["skill"] = normalized_skills[0] if normalized_skills else None

    # Coerce nullable fields
    job_id = normalized.get("id") or "unknown"
    prompt = normalized.get("prompt") or ""
    normalized["id"] = str(job_id)
    normalized["prompt"] = str(prompt)

    name = str(normalized.get("name") or "").strip()
    if not name:
        script = str(normalized.get("script") or "").strip()
        label_source = prompt or (normalized_skills[0] if normalized_skills else "") or script or job_id or "cron job"
        name = str(label_source)[:50].strip() or "cron job"
    normalized["name"] = name

    # Schedule display
    schedule_display = str(normalized.get("schedule_display") or "").strip()
    if not schedule_display:
        schedule = normalized.get("schedule")
        if isinstance(schedule, dict):
            for key in ("display", "value", "expr", "run_at"):
                text = str(schedule.get(key) or "").strip()
                if text:
                    schedule_display = text
                    break
        if not schedule_display:
            schedule_display = "?"
    normalized["schedule_display"] = schedule_display

    state = str(normalized.get("state") or "").strip()
    if not state:
        state = "scheduled" if normalized.get("enabled", True) else "paused"
    normalized["state"] = state

    if "on_success" not in normalized or normalized["on_success"] is None:
        normalized["on_success"] = []

    return normalized


# ---------------------------------------------------------------------------
# Public helper functions (replace cron.jobs API)
# ---------------------------------------------------------------------------

def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Get a job by ID."""
    with _jobs_file_lock:
        jobs = _load_jobs()
        for job in jobs:
            if job["id"] == job_id:
                return _normalize_job_record(job)
    return None


def update_job_field(job_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update fields on a job by ID."""
    # Block mutation of immutable fields
    if "id" in updates:
        raise ValueError("Cron job field 'id' cannot be updated")

    with _jobs_file_lock:
        jobs = _load_jobs()
        for i, job in enumerate(jobs):
            if job["id"] != job_id:
                continue
            updated = {**job, **updates}
            # Re-normalize skills if changed
            if "skills" in updates or "skill" in updates:
                skills = updated.get("skills")
                skill = updated.get("skill")
                if skills is None:
                    raw_items = [skill] if skill else []
                elif isinstance(skills, str):
                    raw_items = [skills]
                else:
                    raw_items = list(skills)
                normalized_skills: List[str] = []
                for item in raw_items:
                    text = str(item or "").strip()
                    if text and text not in normalized_skills:
                        normalized_skills.append(text)
                updated["skills"] = normalized_skills
                updated["skill"] = normalized_skills[0] if normalized_skills else None
            jobs[i] = updated
            _save_jobs(jobs)
            return _normalize_job_record(jobs[i])
    return None


def list_all_jobs(include_disabled: bool = False) -> List[Dict[str, Any]]:
    """List all jobs, optionally including disabled ones."""
    with _jobs_file_lock:
        jobs = [_normalize_job_record(j) for j in _load_jobs()]
        if not include_disabled:
            jobs = [j for j in jobs if j.get("enabled", True)]
        return jobs


def create_job_entry(job: Dict[str, Any]) -> Dict[str, Any]:
    """Add a new job entry to jobs.json."""
    with _jobs_file_lock:
        jobs = _load_jobs()
        jobs.append(job)
        _save_jobs(jobs)
    return _normalize_job_record(job)


def remove_job_entry(job_id: str) -> bool:
    """Remove a job by ID."""
    with _jobs_file_lock:
        jobs = _load_jobs()
        original_len = len(jobs)
        jobs = [j for j in jobs if j["id"] != job_id]
        if len(jobs) < original_len:
            _save_jobs(jobs)
            # Clean up output directory
            try:
                job_output_dir = _OUTPUT_DIR / str(job_id)
                if job_output_dir.exists():
                    import shutil
                    shutil.rmtree(job_output_dir)
            except Exception:
                pass
            return True
    return False


def mark_job_run_local(job_id: str, success: bool, error: Optional[str] = None,
                       delivery_error: Optional[str] = None):
    """Mark a job as having been run (updates jobs.json metadata)."""
    with _jobs_file_lock:
        jobs = _load_jobs()
        for i, job in enumerate(jobs):
            if job["id"] == job_id:
                now_iso = _lycus_now_local().isoformat()
                job["last_run_at"] = now_iso
                job["last_status"] = "ok" if success else "error"
                job["last_error"] = error if not success else None
                job["last_delivery_error"] = delivery_error

                # Increment completed count
                if job.get("repeat"):
                    job["repeat"]["completed"] = job["repeat"].get("completed", 0) + 1
                    times = job["repeat"].get("times")
                    completed = job["repeat"]["completed"]
                    if times is not None and times > 0 and completed >= times:
                        # Remove the job (limit reached)
                        jobs.pop(i)
                        _save_jobs(jobs)
                        return

                # Compute next run
                schedule = job.get("schedule", {})
                kind = schedule.get("kind")
                next_run = _compute_next_run_local(schedule, now_iso)

                if next_run is None:
                    if kind in {"cron", "interval"}:
                        job["state"] = "error"
                        if not job.get("last_error"):
                            job["last_error"] = (
                                "Failed to compute next run for recurring schedule"
                            )
                    else:
                        job["enabled"] = False
                        job["state"] = "completed"
                else:
                    job["next_run_at"] = next_run
                    if job.get("state") != "paused":
                        job["state"] = "scheduled"

                _save_jobs(jobs)
                return

        logger.warning("mark_job_run_local: job_id %s not found, skipping save", job_id)


def _compute_next_run_local(schedule: Dict[str, Any], last_run_at: Optional[str] = None) -> Optional[str]:
    """Compute the next run time for a schedule (self-contained)."""
    now = _lycus_now_local()

    if schedule.get("kind") == "once":
        run_at = schedule.get("run_at")
        if not run_at:
            return None
        try:
            run_at_dt = datetime.fromisoformat(run_at)
            if run_at_dt.tzinfo is None:
                run_at_dt = run_at_dt.astimezone()
            if run_at_dt >= now - timedelta(seconds=120):
                return run_at
        except Exception:
            pass
        return None

    elif schedule.get("kind") == "interval":
        minutes = schedule.get("minutes", 60)
        if last_run_at:
            try:
                last = datetime.fromisoformat(last_run_at)
                if last.tzinfo is None:
                    last = last.astimezone()
                next_run = last + timedelta(minutes=minutes)
            except Exception:
                next_run = now + timedelta(minutes=minutes)
        else:
            next_run = now + timedelta(minutes=minutes)
        return next_run.isoformat()

    elif schedule.get("kind") == "cron":
        try:
            from croniter import croniter
            base_time = now
            if last_run_at:
                try:
                    base_time = datetime.fromisoformat(last_run_at)
                    if base_time.tzinfo is None:
                        base_time = base_time.astimezone()
                except Exception:
                    pass
            cron = croniter(schedule["expr"], base_time)
            next_run = cron.get_next(datetime)
            return next_run.isoformat()
        except Exception:
            pass
        return None

    return None


def advance_next_run_local(job_id: str) -> bool:
    """Preemptively advance next_run_at for a recurring job."""
    with _jobs_file_lock:
        jobs = _load_jobs()
        for job in jobs:
            if job["id"] == job_id:
                kind = job.get("schedule", {}).get("kind")
                if kind not in {"cron", "interval"}:
                    return False
                now_iso = _lycus_now_local().isoformat()
                new_next = _compute_next_run_local(job["schedule"], now_iso)
                if new_next and new_next != job.get("next_run_at"):
                    job["next_run_at"] = new_next
                    _save_jobs(jobs)
                    return True
                return False
        return False


def trigger_job_local(job_id: str) -> Optional[Dict[str, Any]]:
    """Schedule a job to run on the next scheduler tick."""
    return update_job_field(job_id, {
        "enabled": True,
        "state": "scheduled",
        "paused_at": None,
        "paused_reason": None,
        "next_run_at": _lycus_now_local().isoformat(),
    })


def save_job_output_local(job_id: str, output: str):
    """Save job output to file."""
    _ensure_dirs()
    job_output_dir = _OUTPUT_DIR / str(job_id)
    job_output_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(job_output_dir, 0o700)
    except (OSError, NotImplementedError):
        pass

    timestamp = _lycus_now_local().strftime("%Y-%m-%d_%H-%M-%S")
    output_file = job_output_dir / f"{timestamp}.md"

    try:
        from utils import atomic_replace
    except ImportError:
        atomic_replace = None  # type: ignore

    fd, tmp_path = tempfile.mkstemp(
        dir=str(job_output_dir), suffix='.tmp', prefix='.output_'
    )
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(output)
            f.flush()
            os.fsync(f.fileno())
        if atomic_replace:
            atomic_replace(tmp_path, output_file)
        else:
            os.replace(tmp_path, str(output_file))
        try:
            os.chmod(output_file, 0o600)
        except (OSError, NotImplementedError):
            pass
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    return output_file


# =============================================================================
# Self-contained execution path
# =============================================================================
# Replaces run_job() from cron.scheduler. This is a simplified execution path
# suitable for Temporal activities — it handles both no_agent (script-only)
# and LLM-based jobs.

def run_cron_job(job: Dict[str, Any]) -> tuple:
    """Execute a single cron job.

    Returns:
        Tuple of (success, full_output_doc, final_response, error_message)
    """
    _ensure_sys_path()
    job_id = job["id"]
    job_name = str(job.get("name") or job.get("prompt") or job_id or "cron job")
    _job_workdir = None
    _prior_terminal_cwd = None

    # ---------------------------------------------------------------
    # no_agent short-circuit — the script IS the job, no LLM involvement.
    # ---------------------------------------------------------------
    if job.get("no_agent"):
        script_path = job.get("script")
        if not script_path:
            err = "no_agent=True but no script is set for this job"
            logger.error("Job '%s': %s", job_id, err)
            return False, "", "", err

        # Apply workdir if configured
        _wd = (job.get("workdir") or "").strip() or None
        if _wd and Path(_wd).is_dir():
            _prior_terminal_cwd = os.getcwd()
            try:
                os.chdir(_wd)
            except OSError:
                _prior_terminal_cwd = None

        try:
            ok, output = _run_job_script_local(script_path)
        finally:
            if _prior_terminal_cwd is not None:
                try:
                    os.chdir(_prior_terminal_cwd)
                except OSError:
                    pass

        now_iso = _lycus_now_local().strftime("%Y-%m-%d %H:%M:%S")

        if not ok:
            alert = (
                f"\u26a0\ufe0f Cron watchdog '{job_name}' script failed\n\n"
                f"{output}\n\n"
                f"Time: {now_iso}"
            )
            doc = (
                f"# Cron Job: {job_name}\n\n"
                f"**Job ID:** {job_id}\n"
                f"**Run Time:** {now_iso}\n"
                f"**Mode:** no_agent (script)\n"
                f"**Status:** script failed\n\n"
                f"{output}\n"
            )
            return False, doc, alert, output

        # Honour wakeAgent gate
        if not _parse_wake_gate_local(output):
            silent_doc = (
                f"# Cron Job: {job_name}\n\n"
                f"**Job ID:** {job_id}\n"
                f"**Run Time:** {now_iso}\n"
                f"**Mode:** no_agent (script)\n"
                f"**Status:** silent (wakeAgent=false)\n"
            )
            return True, silent_doc, SILENT_MARKER, None

        if not output.strip():
            silent_doc = (
                f"# Cron Job: {job_name}\n\n"
                f"**Job ID:** {job_id}\n"
                f"**Run Time:** {now_iso}\n"
                f"**Mode:** no_agent (script)\n"
                f"**Status:** silent (empty output)\n"
            )
            return True, silent_doc, SILENT_MARKER, None

        doc = (
            f"# Cron Job: {job_name}\n\n"
            f"**Job ID:** {job_id}\n"
            f"**Run Time:** {now_iso}\n"
            f"**Mode:** no_agent (script)\n\n"
            f"---\n\n"
            f"{output}\n"
        )
        return True, doc, output, None

    # ---------------------------------------------------------------
    # Default (LLM) path — construct the agent machinery
    # ---------------------------------------------------------------
    from run_agent import AIAgent

    _session_db = None
    try:
        from lycus_state import SessionDB
        _session_db = SessionDB()
    except Exception as e:
        logger.debug("Job '%s': SQLite session store not available: %s", job.get("id", "?"), e)

    try:
        prompt = _build_job_prompt_local(job)
    except Exception as block_exc:
        logger.warning(
            "Job '%s' (ID: %s): blocked by prompt check — %s",
            job_name, job_id, block_exc,
        )
        blocked_doc = (
            f"# Cron Job: {job_name}\n\n"
            f"**Job ID:** {job_id}\n"
            f"**Run Time:** {_lycus_now_local().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"**Status:** BLOCKED\n\n"
            f"Prompt check failed: {block_exc}\n"
        )
        return False, blocked_doc, "", str(block_exc)

    if prompt is None:
        logger.info("Job '%s': script produced no output, skipping AI call.", job_name)
        return True, "", SILENT_MARKER, None

    _cron_session_id = f"cron_{job_id}_{_lycus_now_local().strftime('%Y%m%d_%H%M%S')}"

    logger.info("Running job '%s' (ID: %s)", job_name, job_id)
    logger.info("Prompt: %s", prompt[:100])

    agent = None

    os.environ["HERMES_CRON_SESSION"] = "1"

    # Set context vars for session/delivery state
    from gateway.session_context import set_session_vars, clear_session_vars, _VAR_MAP
    _ctx_tokens = set_session_vars(platform="", chat_id="", chat_name="")

    # Approval session key
    from tools.approval import set_current_session_key, reset_current_session_key
    _cron_approval_key = f"cron-{job_id}"
    _approval_token = set_current_session_key(_cron_approval_key)

    _cron_delivery_vars = (
        "HERMES_CRON_AUTO_DELIVER_PLATFORM",
        "HERMES_CRON_AUTO_DELIVER_CHAT_ID",
        "HERMES_CRON_AUTO_DELIVER_THREAD_ID",
    )
    for _var_name in _cron_delivery_vars:
        _VAR_MAP[_var_name].set("")

    # Workdir
    _job_workdir = (job.get("workdir") or "").strip() or None
    if _job_workdir and not Path(_job_workdir).is_dir():
        logger.warning(
            "Job '%s': configured workdir %r no longer exists — running without it",
            job_id, _job_workdir,
        )
        _job_workdir = None
    _prior_terminal_cwd = os.environ.get("TERMINAL_CWD", "_UNSET_")
    if _job_workdir:
        os.environ["TERMINAL_CWD"] = _job_workdir
        logger.info("Job '%s': using workdir %s", job_id, _job_workdir)

    try:
        # Re-read .env and config.yaml fresh every run
        try:
            from dotenv import load_dotenv
            _lycus_home_path = None
            try:
                from lycus_constants import get_lycus_home
                _lycus_home_path = get_lycus_home()
            except Exception:
                _lycus_home_path = Path.home() / ".autolycus"
            try:
                load_dotenv(str(_lycus_home_path / ".env"), override=True, encoding="utf-8")
            except UnicodeDecodeError:
                load_dotenv(str(_lycus_home_path / ".env"), override=True, encoding="latin-1")
        except Exception:
            pass

        # Resolve delivery target
        try:
            delivery_target = _resolve_delivery_target_local(job)
        except Exception as e:
            logger.warning("Job '%s': failed to resolve delivery target: %s", job_id, e)
            delivery_target = None

        if delivery_target:
            _VAR_MAP["HERMES_CRON_AUTO_DELIVER_PLATFORM"].set(delivery_target["platform"])
            _VAR_MAP["HERMES_CRON_AUTO_DELIVER_CHAT_ID"].set(str(delivery_target["chat_id"]))
            _VAR_MAP["HERMES_CRON_AUTO_DELIVER_THREAD_ID"].set(
                "" if delivery_target.get("thread_id") is None
                else str(delivery_target["thread_id"])
            )

        model = job.get("model") or os.getenv("HERMES_MODEL") or ""

        # Load config.yaml
        _cfg = {}
        try:
            import yaml
            _cfg_path = None
            try:
                from lycus_constants import get_lycus_home
                _cfg_path = str(get_lycus_home() / "config.yaml")
            except Exception:
                _cfg_path = str(Path.home() / ".autolycus" / "config.yaml")
            if os.path.exists(_cfg_path):
                with open(_cfg_path, encoding="utf-8") as _f:
                    _cfg = yaml.safe_load(_f) or {}
                try:
                    from lycus_cli.config import _expand_env_vars
                    _cfg = _expand_env_vars(_cfg)
                except Exception:
                    pass
                _model_cfg = _cfg.get("model", {})
                if not job.get("model"):
                    if isinstance(_model_cfg, str):
                        model = _model_cfg
                    elif isinstance(_model_cfg, dict):
                        model = _model_cfg.get("default", model)
        except Exception as e:
            logger.warning("Job '%s': failed to load config.yaml, using defaults: %s", job_id, e)

        # Reasoning config
        try:
            from lycus_constants import parse_reasoning_effort
            effort = str(_cfg.get("agent", {}).get("reasoning_effort", "")).strip()
            reasoning_config = parse_reasoning_effort(effort)
        except Exception:
            reasoning_config = None

        # Max iterations
        max_iterations = _cfg.get("agent", {}).get("max_turns") or _cfg.get("max_turns") or 90

        # Provider routing
        pr = _cfg.get("provider_routing", {})

        from lycus_cli.runtime_provider import (
            resolve_runtime_provider,
            format_runtime_provider_error,
        )
        from lycus_cli.auth import AuthError
        try:
            runtime_kwargs = {"requested": job.get("provider")}
            if job.get("base_url"):
                runtime_kwargs["explicit_base_url"] = job.get("base_url")
            runtime = resolve_runtime_provider(**runtime_kwargs)
        except AuthError as auth_exc:
            logger.warning("Job '%s': primary auth failed (%s)", job_id, auth_exc)
            raise RuntimeError(format_runtime_provider_error(auth_exc)) from auth_exc
        except Exception as exc:
            message = format_runtime_provider_error(exc)
            raise RuntimeError(message) from exc

        fallback_model = _cfg.get("fallback_providers") or _cfg.get("fallback_model") or None
        credential_pool = None
        runtime_provider = str(runtime.get("provider") or "").strip().lower()
        if runtime_provider:
            try:
                from agent.credential_pool import load_pool
                pool = load_pool(runtime_provider)
                if pool.has_credentials():
                    credential_pool = pool
            except Exception:
                pass

        # Initialize MCP servers
        try:
            from tools.mcp_tool import discover_mcp_tools
            _mcp_tools = discover_mcp_tools()
        except Exception:
            pass

        # Resolve toolsets
        _enabled_toolsets = job.get("enabled_toolsets")
        _disabled_toolsets = ["cronjob", "messaging", "clarify"]
        try:
            agent_cfg = (_cfg or {}).get("agent") or {}
            user_disabled = agent_cfg.get("disabled_toolsets") or []
            for name in user_disabled:
                name = str(name).strip()
                if name and name not in _disabled_toolsets:
                    _disabled_toolsets.append(name)
        except Exception:
            pass

        agent = AIAgent(
            model=model,
            api_key=runtime.get("api_key"),
            base_url=runtime.get("base_url"),
            provider=runtime.get("provider"),
            api_mode=runtime.get("api_mode"),
            acp_command=runtime.get("command"),
            acp_args=runtime.get("args"),
            max_iterations=max_iterations,
            reasoning_config=reasoning_config,
            fallback_model=fallback_model,
            credential_pool=credential_pool,
            providers_allowed=pr.get("only"),
            providers_ignored=pr.get("ignore"),
            providers_order=pr.get("order"),
            provider_sort=pr.get("sort"),
            openrouter_min_coding_score=(_cfg.get("openrouter") or {}).get("min_coding_score"),
            enabled_toolsets=_enabled_toolsets,
            disabled_toolsets=_disabled_toolsets,
            quiet_mode=True,
            skip_context_files=not bool(_job_workdir),
            load_soul_identity=True,
            skip_memory=True,
            platform="cron",
            session_id=_cron_session_id,
            session_db=_session_db,
        )

        # Run with inactivity timeout
        import concurrent.futures
        import contextvars

        _raw_cron_timeout = os.getenv("HERMES_CRON_TIMEOUT", "").strip()
        if _raw_cron_timeout:
            try:
                _cron_timeout = float(_raw_cron_timeout)
            except (ValueError, TypeError):
                _cron_timeout = 600.0
        else:
            _cron_timeout = 600.0
        _cron_inactivity_limit = _cron_timeout if _cron_timeout > 0 else None
        _POLL_INTERVAL = 5.0
        _cron_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        _cron_context = contextvars.copy_context()
        _cron_future = _cron_pool.submit(_cron_context.run, agent.run_conversation, prompt)
        _inactivity_timeout = False

        try:
            if _cron_inactivity_limit is None:
                result = _cron_future.result()
            else:
                result = None
                while True:
                    done, _ = concurrent.futures.wait(
                        {_cron_future}, timeout=_POLL_INTERVAL,
                    )
                    if done:
                        result = _cron_future.result()
                        break
                    _idle_secs = 0.0
                    if hasattr(agent, "get_activity_summary"):
                        try:
                            _act = agent.get_activity_summary()
                            _idle_secs = _act.get("seconds_since_activity", 0.0)
                        except Exception:
                            pass
                    if _idle_secs >= _cron_inactivity_limit:
                        _inactivity_timeout = True
                        break
        except Exception:
            _cron_pool.shutdown(wait=False, cancel_futures=True)
            raise
        finally:
            _cron_pool.shutdown(wait=False, cancel_futures=True)

        if _inactivity_timeout:
            if hasattr(agent, "interrupt"):
                agent.interrupt("Cron job timed out (inactivity)")
            raise TimeoutError(f"Cron job '{job_name}' timed out due to inactivity")

        if not isinstance(result, dict):
            raise RuntimeError(
                f"agent.run_conversation returned {type(result).__name__} instead of dict"
            )

        if result.get("failed") is True or result.get("completed") is False:
            _err_text = (
                result.get("error")
                or (result.get("final_response") or "").strip()
                or "agent reported failure"
            )
            raise RuntimeError(_err_text)

        final_response = result.get("final_response", "") or ""
        if final_response.strip() == "(No response generated)":
            final_response = ""
        logged_response = final_response if final_response else "(No response generated)"

        output = f"""# Cron Job: {job_name}

**Job ID:** {job_id}
**Run Time:** {_lycus_now_local().strftime('%Y-%m-%d %H:%M:%S')}
**Schedule:** {job.get('schedule_display', 'N/A')}

## Prompt

{prompt}

## Response

{logged_response}
"""

        logger.info("Job '%s' completed successfully", job_name)
        return True, output, final_response, None

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        logger.exception("Job '%s' failed: %s", job_name, error_msg)

        output = f"""# Cron Job: {job_name} (FAILED)

**Job ID:** {job_id}
**Run Time:** {_lycus_now_local().strftime('%Y-%m-%d %H:%M:%S')}
**Schedule:** {job.get('schedule_display', 'N/A')}

## Prompt

{prompt}

## Error

```
{error_msg}
```
"""
        return False, output, "", error_msg

    finally:
        # Restore TERMINAL_CWD
        if _job_workdir:
            if _prior_terminal_cwd == "_UNSET_":
                os.environ.pop("TERMINAL_CWD", None)
            else:
                os.environ["TERMINAL_CWD"] = _prior_terminal_cwd
        # Reset approval session key
        try:
            reset_current_session_key(_approval_token)
        except Exception:
            pass
        # Clean up ContextVar session/delivery state
        clear_session_vars(_ctx_tokens)
        for _var_name in _cron_delivery_vars:
            _VAR_MAP[_var_name].set("")
        if _session_db:
            try:
                _session_db.close()
            except Exception:
                pass
        # Release agent resources
        try:
            if agent is not None:
                agent.close()
        except Exception:
            pass
        try:
            from agent.auxiliary_client import cleanup_stale_async_clients
            cleanup_stale_async_clients()
        except Exception:
            pass


def _run_job_script_local(script_path: str) -> tuple:
    """Execute a cron job's script and capture its output (self-contained)."""
    _ensure_sys_path()
    import subprocess
    import shutil

    try:
        from lycus_constants import get_lycus_home
        _lycus_home_path = get_lycus_home()
    except Exception:
        _lycus_home_path = Path.home() / ".autolycus"

    scripts_dir = _lycus_home_path / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    scripts_dir_resolved = scripts_dir.resolve()

    raw = Path(script_path).expanduser()
    if raw.is_absolute():
        path = raw.resolve()
    else:
        path = (scripts_dir / raw).resolve()

    try:
        path.relative_to(scripts_dir_resolved)
    except ValueError:
        return False, (
            f"Blocked: script path resolves outside the scripts directory "
            f"({scripts_dir_resolved}): {script_path!r}"
        )

    if not path.exists():
        return False, f"Script not found: {path}"
    if not path.is_file():
        return False, f"Script path is not a file: {path}"

    # Default timeout
    script_timeout = 120
    try:
        env_val = os.getenv("HERMES_CRON_SCRIPT_TIMEOUT", "").strip()
        if env_val:
            script_timeout = int(float(env_val))
    except Exception:
        pass

    suffix = path.suffix.lower()
    if suffix in {".sh", ".bash"}:
        _bash = shutil.which("bash") or ("/bin/bash" if os.path.isfile("/bin/bash") else None)
        if _bash is None:
            return False, f"Cannot run .sh/.bash script: bash not found on PATH"
        argv = [_bash, str(path)]
    else:
        argv = [sys.executable, str(path)]

    try:
        popen_kwargs = {}
        if sys.platform == "win32":
            try:
                from lycus_cli._subprocess_compat import windows_hide_flags
                popen_kwargs = {"creationflags": windows_hide_flags()}
            except Exception:
                pass
        result = subprocess.run(
            argv, capture_output=True, text=True,
            timeout=script_timeout, cwd=str(path.parent), **popen_kwargs,
        )
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()

        # Redact secrets
        try:
            from agent.redact import redact_sensitive_text
            stdout = redact_sensitive_text(stdout)
            stderr = redact_sensitive_text(stderr)
        except Exception:
            pass

        if result.returncode != 0:
            parts = [f"Script exited with code {result.returncode}"]
            if stderr:
                parts.append(f"stderr:\n{stderr}")
            if stdout:
                parts.append(f"stdout:\n{stdout}")
            return False, "\n".join(parts)

        return True, stdout

    except subprocess.TimeoutExpired:
        return False, f"Script timed out after {script_timeout}s: {path}"
    except Exception as exc:
        return False, f"Script execution failed: {exc}"


def _parse_wake_gate_local(script_output: str) -> bool:
    """Parse wake gate from script output. Returns True if agent should wake."""
    if not script_output:
        return True
    stripped_lines = [line for line in script_output.splitlines() if line.strip()]
    if not stripped_lines:
        return True
    last_line = stripped_lines[-1].strip()
    try:
        gate = json.loads(last_line)
    except (json.JSONDecodeError, ValueError):
        return True
    if not isinstance(gate, dict):
        return True
    return gate.get("wakeAgent", True) is not False


def _build_job_prompt_local(job: Dict[str, Any]) -> Optional[str]:
    """Build the effective prompt for a cron job (self-contained)."""
    user_prompt = str(job.get("prompt") or "")
    prompt = user_prompt
    skills = job.get("skills")
    has_injected_data = False

    # Run data-collection script if configured
    script_path = job.get("script")
    if script_path:
        success, script_output = _run_job_script_local(script_path)
        if success:
            if script_output:
                prompt = (
                    "## Script Output\n"
                    "The following data was collected by a pre-run script. "
                    "Use it as context for your analysis.\n\n"
                    f"```\n{script_output}\n```\n\n"
                    f"{prompt}"
                )
                has_injected_data = True
            else:
                return None
        else:
            prompt = (
                "## Script Error\n"
                "The data-collection script failed. Report this to the user.\n\n"
                f"```\n{script_output}\n```\n\n"
                f"{prompt}"
            )
            has_injected_data = True

    # Inject output from referenced cron jobs as context
    context_from = job.get("context_from")
    if context_from:
        if isinstance(context_from, str):
            context_from = [context_from]
        for source_job_id in context_from:
            if not source_job_id or not all(c in "0123456789abcdef" for c in source_job_id):
                continue
            try:
                job_output_dir = _OUTPUT_DIR / source_job_id
                if not job_output_dir.exists():
                    continue
                output_files = sorted(
                    job_output_dir.glob("*.md"),
                    key=lambda f: f.stat().st_mtime,
                    reverse=True,
                )
                if not output_files:
                    continue
                latest_output = output_files[0].read_text(encoding="utf-8").strip()
                if len(latest_output) > 8000:
                    latest_output = latest_output[:8000] + "\n\n[... output truncated ...]"
                if latest_output:
                    prompt = (
                        f"## Output from job '{source_job_id}'\n"
                        "The following is the most recent output from a preceding "
                        "cron job. Use it as context for your analysis.\n\n"
                        f"```\n{latest_output}\n```\n\n"
                        f"{prompt}"
                    )
                    has_injected_data = True
            except (OSError, PermissionError):
                pass

    # Prepend cron execution guidance
    cron_hint = (
        "[IMPORTANT: You are running as a scheduled cron job. "
        "DELIVERY: Your final response will be automatically delivered "
        "to the user — do NOT use send_message or try to deliver "
        "the output yourself. Just produce your report/output as your "
        "final response and the system handles the rest. "
        "SILENT: If there is genuinely nothing new to report, respond "
        "with exactly \"[SILENT]\" (nothing else) to suppress delivery. "
        "Never combine [SILENT] with content — either report your "
        "findings normally, or say [SILENT] and nothing more.]\n\n"
    )
    prompt = cron_hint + prompt

    if skills is None:
        legacy = job.get("skill")
        skills = [legacy] if legacy else []
    elif isinstance(skills, str):
        skills = [skills]

    skill_names = [str(name).strip() for name in skills if str(name).strip()]
    if not skill_names:
        return prompt

    # Load skills
    from tools.skills_tool import skill_view
    from tools.skill_usage import bump_use
    from agent.skill_bundles import build_bundle_invocation_message, resolve_bundle_command_key

    parts = []
    skipped: list = []
    for skill_name in skill_names:
        bundle_key = resolve_bundle_command_key(skill_name.lstrip("/"))
        if bundle_key:
            bundle_payload = build_bundle_invocation_message(
                bundle_key, user_instruction="",
                task_id=str(job.get("id") or "") or None,
            )
            if bundle_payload:
                bundle_message, _, _ = bundle_payload
                if parts:
                    parts.append("")
                parts.append(bundle_message)
                continue
            logger.warning(
                "Cron job '%s': bundle '%s' could not load any skills, skipping",
                job.get("name", job.get("id")), skill_name,
            )
            skipped.append(skill_name)
            continue

        try:
            loaded = json.loads(skill_view(skill_name))
        except (json.JSONDecodeError, TypeError):
            logger.warning("Cron job '%s': skill '%s' returned invalid JSON, skipping",
                          job.get("name", job.get("id")), skill_name)
            skipped.append(skill_name)
            continue
        if not loaded.get("success"):
            logger.warning("Cron job '%s': skill not found, skipping",
                          job.get("name", job.get("id")))
            skipped.append(skill_name)
            continue

        try:
            bump_use(skill_name)
        except Exception:
            pass

        content = str(loaded.get("content") or "").strip()
        if parts:
            parts.append("")
        parts.extend([
            f'[IMPORTANT: The user has invoked the "{skill_name}" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]',
            "",
            content,
        ])

    if skipped:
        notice = (
            f"[IMPORTANT: The following skill(s) were listed for this job but could not be found "
            f"and were skipped: {', '.join(skipped)}]"
        )
        parts.insert(0, notice)

    if prompt:
        parts.extend(["", f"The user has provided the following instruction alongside the skill invocation: {prompt}"])

    assembled = "\n".join(parts)

    # Scan for injection patterns
    try:
        from tools.cronjob_tools import _scan_cron_prompt, _scan_cron_skill_assembled
        if has_injected_data:
            cleaned, scan_error = _scan_cron_skill_assembled(assembled)
            assembled = cleaned
            if not scan_error:
                scan_error = _scan_cron_prompt(user_prompt)
        else:
            cleaned, scan_error = _scan_cron_skill_assembled(assembled)
            assembled = cleaned
        if scan_error:
            raise ValueError(f"Prompt injection blocked: {scan_error}")
    except ImportError:
        pass  # Scanner unavailable — proceed without scanning
    except Exception as e:
        if "injection" in str(e).lower() or "blocked" in str(e).lower():
            raise
        pass  # Scanner failure is non-fatal

    return assembled


# =============================================================================
# Self-contained delivery path
# =============================================================================
# Replaces _deliver_result() from cron.scheduler.

def _resolve_delivery_target_local(job: dict) -> Optional[dict]:
    """Resolve the concrete auto-delivery target for a cron job (self-contained)."""
    # Basic resolution without cron.scheduler
    deliver = job.get("deliver", "local")
    if isinstance(deliver, (list, tuple)):
        deliver = ",".join(str(p).strip() for p in deliver if str(p).strip()) or "local"
    if not deliver:
        deliver = "local"

    if deliver == "local":
        return None

    origin = job.get("origin")
    if not isinstance(origin, dict):
        origin = None

    if deliver == "origin" and origin:
        platform = origin.get("platform")
        chat_id = origin.get("chat_id")
        if platform and chat_id:
            return {
                "platform": platform,
                "chat_id": str(chat_id),
                "thread_id": origin.get("thread_id"),
            }

    # Try home channel for known platforms
    platform_name = deliver.split(",")[0].strip().split(":")[0].strip()
    chat_id = _get_home_target_chat_id_local(platform_name)
    if chat_id:
        return {
            "platform": platform_name,
            "chat_id": chat_id,
            "thread_id": None,
        }

    return None


def _get_home_target_chat_id_local(platform_name: str) -> str:
    """Return the configured home target chat/room ID for a delivery platform."""
    _HOME_TARGET_ENV_VARS = {
        "matrix": "MATRIX_HOME_ROOM",
        "telegram": "TELEGRAM_HOME_CHANNEL",
        "discord": "DISCORD_HOME_CHANNEL",
        "slack": "SLACK_HOME_CHANNEL",
        "signal": "SIGNAL_HOME_CHANNEL",
        "mattermost": "MATTERMOST_HOME_CHANNEL",
        "sms": "SMS_HOME_CHANNEL",
        "email": "EMAIL_HOME_ADDRESS",
        "dingtalk": "DINGTALK_HOME_CHANNEL",
        "feishu": "FEISHU_HOME_CHANNEL",
        "wecom": "WECOM_HOME_CHANNEL",
        "weixin": "WEIXIN_HOME_CHANNEL",
        "bluebubbles": "BLUEBUBBLES_HOME_CHANNEL",
        "qqbot": "QQBOT_HOME_CHANNEL",
        "whatsapp": "WHATSAPP_HOME_CHANNEL",
        "whatsapp_cloud": "WHATSAPP_CLOUD_HOME_CHANNEL",
    }
    name = platform_name.lower()
    env_var = _HOME_TARGET_ENV_VARS.get(name)
    if env_var:
        value = os.getenv(env_var, "")
        if not value:
            # Legacy fallback
            legacy_map = {"QQBOT_HOME_CHANNEL": "QQ_HOME_CHANNEL"}
            legacy = legacy_map.get(env_var)
            if legacy:
                value = os.getenv(legacy, "")
        return value
    return ""


def _deliver_result_local(job: dict, content: str) -> Optional[str]:
    """Deliver job output to the configured target(s) (self-contained).

    Returns None on success, or an error string on failure.
    """
    try:
        delivery_target = _resolve_delivery_target_local(job)
    except Exception as e:
        logger.warning("Job '%s': delivery target resolution failed: %s", job["id"], e)
        delivery_target = None

    if not delivery_target:
        if job.get("deliver", "local") != "local":
            msg = f"no delivery target resolved for deliver={job.get('deliver', 'local')}"
            logger.warning("Job '%s': %s", job["id"], msg)
            return msg
        return None

    # Wrap response with header
    wrap_response = True
    try:
        from lycus_cli.config import load_config
        user_cfg = load_config()
        wrap_response = user_cfg.get("cron", {}).get("wrap_response", True)
    except Exception:
        pass

    if wrap_response:
        task_name = job.get("name", job["id"])
        job_id = job.get("id", "")
        delivery_content = (
            f"Cronjob Response: {task_name}\n"
            f"(job_id: {job_id})\n"
            f"-------------\n\n"
            f"{content}\n\n"
            f"To stop or manage this job, send me a new message (e.g. \"stop reminder {task_name}\")."
        )
    else:
        delivery_content = content

    # Extract media files
    media_files = []
    try:
        from gateway.platforms.base import BasePlatformAdapter
        media_files, delivery_content = BasePlatformAdapter.extract_media(delivery_content)
        media_files = BasePlatformAdapter.filter_media_delivery_paths(media_files)
    except Exception:
        pass

    platform_name = delivery_target["platform"]
    chat_id = delivery_target["chat_id"]
    thread_id = delivery_target.get("thread_id")

    logger.debug(
        "Job '%s': delivering to %s:%s thread_id=%s",
        job["id"], platform_name, chat_id, thread_id,
    )

    # Send via platform
    try:
        from tools.send_message_tool import _send_to_platform
        from gateway.config import load_gateway_config, Platform

        config = load_gateway_config()

        try:
            platform = Platform(platform_name.lower())
        except (ValueError, KeyError):
            msg = f"unknown platform '{platform_name}'"
            logger.warning("Job '%s': %s", job["id"], msg)
            return msg

        pconfig = config.platforms.get(platform)
        if not pconfig or not pconfig.enabled:
            msg = f"platform '{platform_name}' not configured/enabled"
            logger.warning("Job '%s': %s", job["id"], msg)
            return msg

        # Send text
        text_to_send = delivery_content.strip()
        if text_to_send:
            coro = _send_to_platform(
                platform, pconfig, chat_id, text_to_send,
                thread_id=thread_id, media_files=media_files,
            )
            try:
                result = asyncio.run(coro)
            except RuntimeError:
                # Running loop conflict — use a fresh thread
                coro.close()
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(
                        asyncio.run,
                        _send_to_platform(platform, pconfig, chat_id, text_to_send,
                                         thread_id=thread_id, media_files=media_files),
                    )
                    result = future.result(timeout=30)
            except Exception as e:
                msg = f"delivery to {platform_name}:{chat_id} failed: {e}"
                logger.error("Job '%s': %s", job["id"], msg)
                return msg

            if result and result.get("error"):
                msg = f"delivery error: {result['error']}"
                logger.error("Job '%s': %s", job["id"], msg)
                return msg

        logger.info("Job '%s': delivered to %s:%s", job["id"], platform_name, chat_id)
        return None

    except Exception as e:
        msg = f"delivery failed: {e}"
        logger.error("Job '%s': %s", job["id"], msg)
        return msg


# =============================================================================
# Activity definitions
# =============================================================================

# Guard: when temporalio is not available, @activity.defn is a no-op so the
# module still loads.  The activity functions are always defined (they're also
# referenced by TemporalCronBridge.start_worker).

if not HAS_TEMPORAL:
    class _activity_stub:
        @staticmethod
        def defn(fn):
            return fn
    activity = _activity_stub()  # type: ignore[assignment]


@activity.defn
async def execute_cron_job(job_id: str) -> Dict[str, Any]:
    """Execute a single cron job and return (success, output, final_response).

    Self-contained: reads job from jobs.json, executes via run_cron_job,
    and updates metadata directly.
    """
    try:
        job = get_job(job_id)
        if job is None:
            return {
                "success": False,
                "output": f"Job '{job_id}' not found",
                "final_response": "",
                "error": f"Job '{job_id}' not found in jobs.json",
                "on_success": [],
            }

        # Run the self-contained execution logic.
        success, output, final_response, error = run_cron_job(job)

        # Update job metadata in jobs.json
        mark_job_run_local(job_id, success, error=error)
        advance_next_run_local(job_id)

        return {
            "success": success,
            "output": output,
            "final_response": final_response,
            "error": error,
            "on_success": list(job.get("on_success") or []),
        }

    except Exception as exc:
        logger.exception("execute_cron_job activity failed for %s", job_id)
        return {
            "success": False,
            "output": "",
            "final_response": "",
            "error": f"{type(exc).__name__}: {exc}",
            "on_success": [],
        }


@activity.defn
async def save_cron_output(job_id: str, output: str = "") -> Dict[str, Any]:
    """Save job output to the cron output directory."""
    try:
        # If no output provided, look up from job's last run
        if not output:
            job = get_job(job_id)
            if job:
                output = job.get("last_output", "")

        if not output:
            return {"success": True, "path": ""}  # Nothing to save

        path = save_job_output_local(job_id, output)
        return {"success": True, "path": str(path)}
    except Exception as exc:
        logger.exception("save_cron_output activity failed for %s", job_id)
        return {"success": False, "error": str(exc)}


@activity.defn
async def deliver_cron_result(job_id: str) -> Dict[str, Any]:
    """Deliver job result to configured target(s).

    Self-contained: reads content and success status from jobs.json.
    """
    try:
        job = get_job(job_id)
        if job is None:
            return {"success": True}

        # Read last run state from jobs.json
        last_status = job.get("last_status", "unknown")
        success = last_status == "ok"
        content = job.get("last_output", "") or ""
        last_error = job.get("last_error", "") or ""

        # Respect [SILENT] marker — skip delivery but output already saved.
        stripped = content.strip()
        if success and SILENT_MARKER in stripped.upper():
            logger.info("Job '%s': agent returned %s — skipping delivery", job_id, SILENT_MARKER)
            return {"success": True}

        job_name = job.get("name", job_id)
        if not success:
            error_part = ""
            if "## Error" in content:
                error_part = content.split("## Error")[-1].strip()
            elif last_error:
                error_part = last_error
            deliver_content = (
                f"\u26a0\ufe0f Cron job '{job_name}' failed:\n{error_part or 'See logs for details'}"
            )
        else:
            deliver_content = stripped if stripped else ""

        if not deliver_content:
            return {"success": True}

        delivery_error = _deliver_result_local(job, deliver_content)
        if delivery_error:
            return {"success": False, "error": delivery_error}
        return {"success": True}

    except Exception as exc:
        logger.exception("deliver_cron_result activity failed for %s", job_id)
        return {"success": False, "error": str(exc)}


@activity.defn
async def mark_job_run_activity(job_id: str) -> Dict[str, Any]:
    """Mark a job as having been run (updates jobs.json metadata).

    Self-contained. Note: execute_cron_job already calls mark_job_run_local,
    so this is effectively a no-op idempotent marker.
    """
    try:
        job = get_job(job_id)
        if job is None:
            return {"success": True}

        # Already marked by run_cron_job — just verify state is consistent
        return {"success": True}
    except Exception as exc:
        logger.exception("mark_job_run_activity failed for %s", job_id)
        return {"success": False, "error": str(exc)}


@activity.defn
async def trigger_on_success_jobs(job_id: str) -> Dict[str, Any]:
    """Trigger dependent jobs listed in on_success after a successful run.

    Self-contained: reads on_success from jobs.json.
    Only triggers if the job's last_status was 'ok'.
    """
    try:
        job = get_job(job_id)
        if job is None:
            return {"success": True, "triggered": [], "skipped": []}

        # Only trigger on_success if the job succeeded
        if job.get("last_status") != "ok":
            return {"success": True, "triggered": [], "skipped": [], "reason": "job failed"}

        on_success_ids = job.get("on_success") or []
        triggered = []
        skipped = []

        for target_id in on_success_ids:
            if target_id == job_id:
                continue

            target = get_job(target_id)
            if not target or not target.get("enabled", True):
                skipped.append(target_id)
                continue

            try:
                bridge = TemporalCronBridge.get_instance()
                if bridge and bridge.is_available():
                    result = await bridge.trigger_job_immediate(target_id)
                    if result:
                        triggered.append(target_id)
                    else:
                        skipped.append(target_id)
                else:
                    # Fallback: mark the job as due for next tick.
                    trigger_job_local(target_id)
                    logger.info(
                        "on_success fallback: marked %s as due (Temporal unavailable)",
                        target_id,
                    )
            except Exception as exc:
                logger.warning("Failed to trigger on_success job %s: %s", target_id, exc)
                skipped.append(target_id)

        return {"success": True, "triggered": triggered, "skipped": skipped}

    except Exception as exc:
        logger.exception("trigger_on_success_jobs failed for %s", job_id)
        return {"success": False, "error": str(exc)}


# =============================================================================
# Temporal Workflow definition
# =============================================================================
# NOTE: The CronJobWorkflow is defined in temporal_workflows/cron_workflow.py,
# NOT here. This avoids the sandbox import chain violation:
#   cron/__init__.py -> cron.jobs -> croniter -> platform -> subprocess (blocked)
#
# Import it from its canonical location for convenience.

if HAS_TEMPORAL:
    try:
        from temporal_workflows.cron_workflow import CronJobWorkflow  # noqa: E402
    except ImportError:
        CronJobWorkflow = None  # type: ignore[assignment,misc]
else:
    CronJobWorkflow = None  # type: ignore[assignment,misc]


# =============================================================================
# TemporalCronBridge — the integration layer
# =============================================================================

class TemporalCronBridge:
    """Bridges existing cron job definitions to Temporal workflow orchestration.

    Responsibilities:
      - Manage Temporal client connection (lazy, with fallback)
      - Convert jobs.json schedule kinds -> Temporal Schedule specs
      - Register / update / remove Temporal schedules for each job
      - Start the Temporal worker that executes CronJobWorkflow + activities
      - Provide graceful fallback to file-based tick() when Temporal is down

    Usage:
        bridge = TemporalCronBridge.get_instance()
        if bridge.is_available():
            await bridge.sync_schedules()  # Align jobs.json -> Temporal schedules
            await bridge.start_worker()     # Run the worker loop
        else:
            cron.scheduler.tick()           # Fallback to existing scheduler
    """

    _instance: Optional["TemporalCronBridge"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._client: Any = None  # TemporalClient when HAS_TEMPORAL
        self._worker: Any = None  # TemporalWorker when HAS_TEMPORAL
        self._available = False
        self._synced_job_ids: set = set()

    @classmethod
    def get_instance(cls) -> Optional["TemporalCronBridge"]:
        """Get or create the singleton bridge instance."""
        if not HAS_TEMPORAL:
            return None
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    async def _connect(self) -> bool:
        """Establish connection to Temporal server. Returns True on success."""
        try:
            self._client = await TemporalClient.connect(  # type: ignore[name-defined]
                f"{TEMPORAL_HOST}:{TEMPORAL_PORT}",
                namespace=TEMPORAL_NAMESPACE,
            )
            self._available = True
            logger.info("TemporalCronBridge connected to %s:%s", TEMPORAL_HOST, TEMPORAL_PORT)
            return True
        except Exception as exc:
            logger.warning("TemporalCronBridge connection failed: %s — falling back to file scheduler", exc)
            self._available = False
            return False

    def is_available(self) -> bool:
        """Whether Temporal is connected and usable."""
        return self._available and self._client is not None

    async def ensure_connected(self) -> bool:
        """Connect if not already connected. Returns availability status."""
        if self.is_available():
            return True
        return await self._connect()

    # -----------------------------------------------------------------------
    # Schedule conversion: jobs.json -> Temporal schedules
    # -----------------------------------------------------------------------

    @staticmethod
    def _job_schedule_id(job_id: str) -> str:
        """Return the Temporal schedule ID for a cron job."""
        return f"lycus-cron-{job_id}"

    @staticmethod
    def _schedule_kind_to_temporal_spec(
        schedule: Dict[str, Any]
    ) -> Optional[Any]:  # ScheduleSpec when HAS_TEMPORAL
        """Convert a jobs.json schedule dict to a Temporal ScheduleSpec.

        Returns None for one-shot schedules (handled via immediate workflow start).
        For interval/cron kinds, returns the appropriate ScheduleSpec.
        """
        if not HAS_TEMPORAL:
            return None

        kind = schedule.get("kind")

        if kind == "once":
            return None  # Handled separately as immediate workflow + start_delay

        elif kind == "interval":
            minutes = schedule.get("minutes", 60)
            intervals: Sequence[Any] = [
                ScheduleIntervalSpec(every=timedelta(minutes=minutes))  # type: ignore[name-defined]
            ]
            return ScheduleSpec(intervals=intervals)  # type: ignore[name-defined]

        elif kind == "cron":
            expr = schedule.get("expr", "")
            if not expr:
                return None
            # Temporal supports cron expressions natively via ScheduleSpec.cron_expressions.
            return ScheduleSpec(cron_expressions=[expr])  # type: ignore[name-defined]

        return None

    async def sync_schedules(self) -> Dict[str, Any]:
        """Align Temporal schedules with current jobs.json state.

        Creates/updates/removes Temporal schedules to match the job definitions.
        Returns a report of what changed.
        """
        if not await self.ensure_connected():
            return {"error": "Temporal unavailable", "fallback": "tick()"}

        try:
            # Self-contained: read jobs directly
            all_jobs = list_all_jobs(include_disabled=True)
            active_jobs = list_all_jobs(include_disabled=False)

            report = {
                "created": [],
                "updated": [],
                "removed": [],
                "skipped_oneshot": [],
                "errors": [],
            }

            # Build set of expected schedule IDs.
            expected_ids: set = set()
            for job in active_jobs:
                sid = self._job_schedule_id(job["id"])
                expected_ids.add(sid)

                if job.get("schedule", {}).get("kind") == "once":
                    report["skipped_oneshot"].append(job["id"])
                    continue

                temporal_spec = self._schedule_kind_to_temporal_spec(
                    job.get("schedule", {})
                )
                if not temporal_spec:
                    logger.debug(
                        "Job '%s' has no recurring schedule for Temporal (kind=%s)",
                        job["id"],
                        job.get("schedule", {}).get("kind"),
                    )
                    continue

                try:
                    await self._upsert_schedule(job, temporal_spec)
                    report["created"].append(job["id"])
                except Exception as upsert_err:
                    logger.warning(
                        "Schedule upsert failed for job '%s': %s — falling back to file ticker",
                        job["id"],
                        upsert_err,
                    )
                    report["errors"].append(job["id"])

            # Remove stale schedules (jobs that were deleted or disabled).
            if self._client:
                schedule_iter = await self._client.list_schedules()
                async for desc in schedule_iter:
                    sid = desc.id  # ScheduleListDescription uses .id, not .schedule_id
                    if not sid.startswith("lycus-cron-"):
                        continue
                    if sid not in expected_ids:
                        await self._client.delete_schedule(sid)
                        report["removed"].append(sid)

            return report

        except Exception as exc:
            logger.exception("sync_schedules failed")
            return {"error": str(exc)}

    async def _upsert_schedule(
        self, job: Dict[str, Any], spec: Any  # ScheduleSpec when HAS_TEMPORAL
    ) -> None:
        """Create or update a Temporal schedule for a job."""
        if not self._client or not HAS_TEMPORAL:
            return

        sid = self._job_schedule_id(job["id"])
        action = ScheduleActionStartWorkflow(  # type: ignore[name-defined]
            workflow="CronJobWorkflow",
            args=[job["id"]],
            task_queue=TEMPORAL_TASK_QUEUE,
            id=f"{sid}-run-{{run_id}}",
            execution_timeout=timedelta(hours=2),
            run_timeout=timedelta(minutes=30),
            task_timeout=timedelta(minutes=5),
        )

        policy = SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP)  # type: ignore[name-defined]
        schedule = Schedule(action=action, spec=spec, policy=policy)  # type: ignore[name-defined]

        try:
            handle = self._client.get_schedule_handle(sid)
            # Try to update existing schedule.
            async def _updater(inp: UpdateScheduleInput) -> Any:  # type: ignore[type-arg]
                return ScheduleUpdate(schedule=schedule)  # type: ignore[name-defined]

            await handle.update(_updater)
        except Exception as exc:
            # Any update failure means the schedule likely doesn't exist yet
            # (or the update callback failed) — try to create it.
            try:
                await self._client.create_schedule(sid, schedule)
            except Exception as create_err:
                # UNIQUE constraint means schedule already exists (race or prior run) — not an error.
                if "unique" not in str(create_err).lower() and "already exists" not in str(create_err).lower():
                    logger.warning("Failed to upsert schedule %s: update=%s, create=%s", sid, exc, create_err)

    async def remove_schedule(self, job_id: str) -> bool:
        """Remove the Temporal schedule for a specific job."""
        if not await self.ensure_connected():
            return False

        try:
            sid = self._job_schedule_id(job_id)
            await self._client.delete_schedule(sid)
            logger.info("Removed Temporal schedule for job %s", job_id)
            return True
        except Exception as exc:
            logger.warning("Failed to remove schedule for %s: %s", job_id, exc)
            return False

    # -----------------------------------------------------------------------
    # Immediate triggers (for one-shot jobs and manual trigger_job calls)
    # -----------------------------------------------------------------------

    async def trigger_job_immediate(self, job_id: str) -> Optional[str]:
        """Trigger a job to run immediately by updating its next_run_at.

        Self-contained: updates jobs.json directly.
        """
        try:
            update_job_field(job_id, {
                "enabled": True,
                "state": "scheduled",
                "next_run_at": _lycus_now_local().isoformat(),
            })
            logger.info("Triggered immediate run for job %s", job_id)
            return job_id
        except Exception as exc:
            logger.error("Failed to trigger job %s: %s", job_id, exc)
            return None

    @staticmethod
    def _run_timestamp() -> str:
        """Return a compact timestamp string for unique workflow IDs."""
        dt = datetime.now()
        return dt.strftime("%Y%m%d_%H%M%S")

    # -----------------------------------------------------------------------
    # Worker management
    # -----------------------------------------------------------------------

    async def start_worker(self) -> Any:  # TemporalWorker when HAS_TEMPORAL
        """Start the Temporal worker that executes cron workflows + activities.

        Returns the Worker instance, or None if Temporal is unavailable.
        """
        if not await self.ensure_connected():
            return None

        try:
            # Build activity list dynamically.
            activities_list = [
                execute_cron_job,
                save_cron_output,
                deliver_cron_result,
                mark_job_run_activity,
                trigger_on_success_jobs,
            ]

            workflow_list: List[Any] = []
            if HAS_TEMPORAL and CronJobWorkflow is not None:
                workflow_list.append(CronJobWorkflow)  # type: ignore[possibly-used-before-def]

            self._worker = TemporalWorker(  # type: ignore[name-defined]
                self._client,
                task_queue=TEMPORAL_TASK_QUEUE,
                workflows=workflow_list,
                activities=activities_list,
            )

            logger.info("TemporalCronBridge worker started on queue '%s'", TEMPORAL_TASK_QUEUE)
            return self._worker

        except Exception as exc:
            logger.error("Failed to start Temporal worker: %s", exc)
            self._available = False
            return None

    async def run_worker(self) -> None:
        """Run the worker until interrupted (blocks)."""
        worker = await self.start_worker()
        if worker is None:
            logger.warning("Cannot run worker — Temporal unavailable, falling back to tick()")
            return

        try:
            await worker.run()
        except KeyboardInterrupt:
            logger.info("TemporalCronBridge worker stopped.")

    async def stop(self) -> None:
        """Shut down the bridge (close client, stop worker)."""
        if self._worker:
            # Worker shutdown is handled by Temporal on process exit.
            self._worker = None
        if self._client:
            self._client = None
        self._available = False


# =============================================================================
# Convenience functions — drop-in replacements for cronjob() calls
# =============================================================================

async def schedule_job_via_temporal(job_id: str) -> Dict[str, Any]:
    """Schedule or trigger a job through Temporal.

    For recurring jobs: creates/updates the Temporal schedule.
    For one-shot jobs: starts an immediate workflow run.
    Falls back to file-based scheduling if Temporal is unavailable.
    """
    bridge = TemporalCronBridge.get_instance()

    if not bridge or not await bridge.ensure_connected():
        logger.info("Temporal unavailable for job %s — using file scheduler", job_id)
        result = trigger_job_local(job_id)
        return {
            "method": "fallback_tick",
            "job_id": job_id,
            "result": result is not None,
        }

    try:
        job = get_job(job_id)
        if not job:
            return {"error": f"Job {job_id} not found"}

        kind = job.get("schedule", {}).get("kind")

        if kind == "once":
            wf_id = await bridge.trigger_job_immediate(job_id)
            return {
                "method": "temporal_workflow",
                "job_id": job_id,
                "workflow_id": wf_id,
            }
        else:
            # Recurring — sync the schedule.
            report = await bridge.sync_schedules()
            return {
                "method": "temporal_schedule",
                "job_id": job_id,
                "report": report,
            }

    except Exception as exc:
        logger.error("schedule_job_via_temporal failed for %s: %s", job_id, exc)
        # Fallback to file-based.
        trigger_job_local(job_id)
        return {
            "method": "fallback_tick_after_error",
            "job_id": job_id,
            "error": str(exc),
        }


async def bridge_tick(
    verbose: bool = True,
    adapters=None,
    loop=None,
    sync: bool = True,
) -> int:
    """Bridge version of tick() — routes through Temporal when available.

    If Temporal is connected and schedules are synced, this is a no-op because
    Temporal handles execution autonomously. Returns 0 to indicate "handled by Temporal".

    Falls back to the existing file-based tick() if Temporal is unavailable.
    Passes *adapters*, *loop*, and *sync* through to the underlying tick()
    for E2EE delivery support.
    """
    bridge = TemporalCronBridge.get_instance()

    if not bridge or not await bridge.ensure_connected():
        logger.info("bridge_tick: Temporal unavailable, falling back to tick()")
        from cron.scheduler import tick as _tick
        return _tick(verbose=verbose, adapters=adapters, loop=loop, sync=sync)

    # Ensure schedules are in sync.
    report = await bridge.sync_schedules()
    if "error" in report:
        logger.warning("bridge_tick: schedule sync failed (%s), falling back to tick()", report["error"])
        from cron.scheduler import tick as _tick
        return _tick(verbose=verbose, adapters=adapters, loop=loop, sync=sync)

    # Temporal is handling execution — nothing for us to do.
    if verbose:
        logger.info("bridge_tick: Temporal managing schedules (synced %d jobs)", len(report.get("created", [])))
    return 0


def cronjob_bridge_create_job(**kwargs) -> Dict[str, Any]:
    """Create a job and optionally register it with Temporal.

    Self-contained: creates job entry directly in jobs.json.
    Returns the created job dict.
    """
    import uuid
    import re

    prompt = kwargs.get("prompt")
    schedule_str = kwargs.get("schedule")
    name = kwargs.get("name")
    repeat = kwargs.get("repeat")
    deliver = kwargs.get("deliver")
    origin = kwargs.get("origin")
    skill = kwargs.get("skill")
    skills = kwargs.get("skills")
    model = kwargs.get("model")
    provider = kwargs.get("provider")
    base_url = kwargs.get("base_url")
    script = kwargs.get("script")
    context_from = kwargs.get("context_from")
    on_success = kwargs.get("on_success")
    enabled_toolsets = kwargs.get("enabled_toolsets")
    workdir = kwargs.get("workdir")
    no_agent = bool(kwargs.get("no_agent", False))

    # Parse schedule — use croniter if available, otherwise basic parsing
    parsed_schedule = _parse_schedule_local(schedule_str)

    # Normalize repeat
    if repeat is not None and repeat <= 0:
        repeat = None
    if parsed_schedule["kind"] == "once" and repeat is None:
        repeat = 1

    # Default delivery
    if deliver is None:
        deliver = "origin" if origin else "local"

    job_id = uuid.uuid4().hex[:12]
    now_iso = _lycus_now_local().isoformat()

    # Normalize skills
    if skills is None:
        raw_skills = [skill] if skill else []
    elif isinstance(skills, str):
        raw_skills = [skills]
    else:
        raw_skills = list(skills)
    normalized_skills: List[str] = []
    for item in raw_skills:
        text = str(item or "").strip()
        if text and text not in normalized_skills:
            normalized_skills.append(text)

    # Normalize other fields
    normalized_model = str(model).strip() if isinstance(model, str) else None
    normalized_provider = str(provider).strip() if isinstance(provider, str) else None
    normalized_base_url = str(base_url).strip().rstrip("/") if isinstance(base_url, str) else None
    normalized_model = normalized_model or None
    normalized_provider = normalized_provider or None
    normalized_base_url = normalized_base_url or None
    normalized_script = str(script).strip() if isinstance(script, str) else None
    normalized_script = normalized_script or None
    normalized_toolsets = [str(t).strip() for t in enabled_toolsets if str(t).strip()] if enabled_toolsets else None
    normalized_toolsets = normalized_toolsets or None

    # Normalize context_from
    if isinstance(context_from, str):
        context_from = [context_from.strip()] if context_from.strip() else None
    elif isinstance(context_from, list):
        context_from = [str(j).strip() for j in context_from if str(j).strip()] or None
    else:
        context_from = None

    # Normalize on_success
    if isinstance(on_success, str):
        on_success = [on_success.strip()] if on_success.strip() else []
    elif isinstance(on_success, list):
        on_success = [str(j).strip() for j in on_success if str(j).strip()]
    else:
        on_success = []

    # Normalize workdir
    normalized_workdir = None
    if workdir:
        raw_wd = str(workdir).strip()
        if raw_wd:
            expanded = Path(raw_wd).expanduser()
            if expanded.is_absolute() and expanded.exists() and expanded.is_dir():
                normalized_workdir = str(expanded.resolve())

    prompt_text = str(prompt) if prompt else ""
    label_source = (prompt_text or (normalized_skills[0] if normalized_skills else None) or (normalized_script if no_agent else None)) or "cron job"

    job = {
        "id": job_id,
        "name": name or label_source[:50].strip(),
        "prompt": prompt_text,
        "skills": normalized_skills,
        "skill": normalized_skills[0] if normalized_skills else None,
        "model": normalized_model,
        "provider": normalized_provider,
        "base_url": normalized_base_url,
        "script": normalized_script,
        "no_agent": bool(no_agent),
        "context_from": context_from,
        "on_success": on_success,
        "schedule": parsed_schedule,
        "schedule_display": parsed_schedule.get("display", schedule_str),
        "repeat": {"times": repeat, "completed": 0},
        "enabled": True,
        "state": "scheduled",
        "paused_at": None,
        "paused_reason": None,
        "created_at": now_iso,
        "next_run_at": _compute_next_run_local(parsed_schedule),
        "last_run_at": None,
        "last_status": None,
        "last_error": None,
        "last_delivery_error": None,
        "deliver": deliver,
        "origin": origin,
        "enabled_toolsets": normalized_toolsets,
        "workdir": normalized_workdir,
    }

    job = create_job_entry(job)

    # Fire-and-forget: try to register with Temporal in background.
    bridge = TemporalCronBridge.get_instance()
    if bridge and HAS_TEMPORAL:
        async def _sync():
            await bridge.ensure_connected()
            await bridge.sync_schedules()

        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                asyncio.create_task(_sync())
            else:
                asyncio.run(_sync())
        except Exception as exc:
            logger.debug("Background Temporal sync after job creation failed: %s", exc)

    return job


def _parse_schedule_local(schedule: str) -> Dict[str, Any]:
    """Parse schedule string into structured format (self-contained)."""
    schedule = schedule.strip()
    original = schedule
    schedule_lower = schedule.lower()

    # "every X" pattern -> recurring interval
    if schedule_lower.startswith("every "):
        duration_str = schedule[6:].strip()
        minutes = _parse_duration_local(duration_str)
        return {"kind": "interval", "minutes": minutes, "display": f"every {minutes}m"}

    # Check for cron expression (5 or 6 space-separated fields)
    parts = schedule.split()
    if len(parts) >= 5 and all(re.match(r'^[\d\*\-,/]+$', p) for p in parts[:5]):
        return {"kind": "cron", "expr": schedule, "display": schedule}

    # ISO timestamp
    if 'T' in schedule or re.match(r'^\d{4}-\d{2}-\d{2}', schedule):
        try:
            dt = datetime.fromisoformat(schedule.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.astimezone()
            return {
                "kind": "once",
                "run_at": dt.isoformat(),
                "display": f"once at {dt.strftime('%Y-%m-%d %H:%M')}",
            }
        except ValueError:
            pass

    # Duration like "30m", "2h", "1d" -> one-shot from now
    try:
        minutes = _parse_duration_local(schedule)
        run_at = _lycus_now_local() + timedelta(minutes=minutes)
        return {
            "kind": "once",
            "run_at": run_at.isoformat(),
            "display": f"once in {original}",
        }
    except ValueError:
        pass

    raise ValueError(
        f"Invalid schedule '{original}'. Use:\n"
        f"  - Duration: '30m', '2h', '1d' (one-shot)\n"
        f"  - Interval: 'every 30m', 'every 2h' (recurring)\n"
        f"  - Cron: '0 9 * * *' (cron expression)\n"
        f"  - Timestamp: '2026-02-03T14:00:00' (one-shot at time)"
    )


def _parse_duration_local(s: str) -> int:
    """Parse duration string into minutes (self-contained)."""
    s = s.strip().lower()
    match = re.match(r'^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$', s)
    if not match:
        raise ValueError(f"Invalid duration: '{s}'. Use format like '30m', '2h', or '1d'")
    value = int(match.group(1))
    unit = match.group(2)[0]
    multipliers = {'m': 1, 'h': 60, 'd': 1440}
    return value * multipliers[unit]


def cronjob_bridge_remove_job(job_id: str) -> bool:
    """Remove a job from both jobs.json and Temporal schedules."""
    # Remove from Temporal first (best-effort).
    bridge = TemporalCronBridge.get_instance()
    if bridge and HAS_TEMPORAL:
        try:
            asyncio.run(bridge.remove_schedule(job_id))
        except Exception as exc:
            logger.debug("Failed to remove Temporal schedule for %s: %s", job_id, exc)

    # Remove from jobs.json (self-contained).
    return remove_job_entry(job_id)


def cronjob_bridge_trigger_job(job_id: str) -> Dict[str, Any]:
    """Trigger a job immediately through Temporal (or fallback)."""
    bridge = TemporalCronBridge.get_instance()

    if not bridge or not HAS_TEMPORAL:
        result = trigger_job_local(job_id)
        return {"method": "fallback_tick", "job_id": job_id, "ok": result is not None}

    async def _do_trigger():
        wf_id = await bridge.trigger_job_immediate(job_id)
        if wf_id:
            return {"method": "temporal_workflow", "job_id": job_id, "workflow_id": wf_id}
        # Fallback.
        trigger_job_local(job_id)
        return {"method": "fallback_tick", "job_id": job_id, "ok": True}

    try:
        loop = asyncio.get_running_loop()
        if loop.is_running():
            # Can't block on an already-running loop — fire and forget.
            asyncio.create_task(_do_trigger())
            return {"method": "async_temporal", "job_id": job_id, "status": "queued"}
        else:
            return asyncio.run(_do_trigger())
    except Exception as exc:
        logger.warning("cronjob_bridge_trigger_job failed for %s: %s — falling back", job_id, exc)
        trigger_job_local(job_id)
        return {"method": "fallback_tick", "job_id": job_id, "ok": True}


# =============================================================================
# Thin wrappers — expose cron.jobs / cron.scheduler through the bridge so
# callers outside cron/ never import from cron.jobs or cron.scheduler directly.
# =============================================================================


def bridge_get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Get a job by ID."""
    from cron.jobs import get_job as _get_job
    return _get_job(job_id)


def bridge_update_job(job_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a job by ID."""
    from cron.jobs import update_job as _update_job
    return _update_job(job_id, updates)


def bridge_pause_job(job_id: str, reason: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Pause a job."""
    from cron.jobs import pause_job as _pause_job
    return _pause_job(job_id, reason=reason)


def bridge_resume_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Resume a paused job."""
    from cron.jobs import resume_job as _resume_job
    return _resume_job(job_id)


def bridge_cron_delivery_targets() -> list[dict]:
    """Return the platforms a cron job can auto-deliver to."""
    from cron.scheduler import cron_delivery_targets as _cdt
    return _cdt()


# Re-export AmbiguousJobReference so callers don't need to import cron.jobs
class AmbiguousJobReference(LookupError):
    """Raised when a job name matches more than one job (re-exported from cron.jobs)."""

    def __init__(self, ref: str, matches: List[Dict[str, Any]]):
        self.ref = ref
        self.matches = matches
        ids = ", ".join(m["id"] for m in matches)
        super().__init__(
            f"Job name '{ref}' is ambiguous — matches {len(matches)} jobs: {ids}. "
            f"Use the job ID instead."
        )


def bridge_resolve_job_ref(ref: str) -> Optional[Dict[str, Any]]:
    """Resolve a job reference (ID or name) to a job record."""
    from cron.jobs import resolve_job_ref as _resolve
    return _resolve(ref)


def bridge_rewrite_skill_refs(
    consolidated: Optional[Dict[str, str]] = None,
    pruned: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Rewrite cron job skill references after a curator consolidation pass."""
    from cron.jobs import rewrite_skill_refs as _rewrite
    return _rewrite(consolidated=consolidated, pruned=pruned)


def bridge_load_jobs() -> List[Dict[str, Any]]:
    """Load all jobs from jobs.json (raw, under lock)."""
    from cron.jobs import load_jobs as _load
    return _load()


def bridge_save_jobs(jobs: List[Dict[str, Any]]) -> None:
    """Save jobs list to jobs.json (under lock)."""
    from cron.jobs import save_jobs as _save
    _save(jobs)


def bridge_jobs_lock():
    """Return the cross-process lock used for jobs.json access."""
    from cron.jobs import _jobs_lock as _lock
    return _lock()


def bridge_resolve_home_env_var(platform_name: str) -> str:
    """Return the configured home-target env var for a platform."""
    from cron.scheduler import _resolve_home_env_var as _rh
    return _rh(platform_name)


def bridge_parse_schedule(schedule: str) -> Dict[str, Any]:
    """Parse a schedule string into a schedule dict."""
    from cron.jobs import parse_schedule as _ps
    return _ps(schedule)