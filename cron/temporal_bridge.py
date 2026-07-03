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
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
from datetime import timedelta
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


# =============================================================================
# Activity definitions
# =============================================================================

@activity.defn
async def execute_cron_job(job_id: str) -> Dict[str, Any]:
    """Execute a single cron job and return (success, output, final_response).

    This activity runs the existing run_job() logic from scheduler.py so all
    current features (skills, model overrides, no_agent mode, workdir, etc.)
    are preserved. Temporal provides retry + heartbeat guarantees around it.

    Returns a dict with keys: success, output, final_response, error, on_success.
    The on_success list is included so the workflow can trigger dependent jobs.
    """
    try:
        from cron.scheduler import run_job
        from cron.jobs import get_job

        job = get_job(job_id)
        if job is None:
            return {
                "success": False,
                "output": f"Job '{job_id}' not found",
                "final_response": "",
                "error": f"Job '{job_id}' not found in jobs.json",
                "on_success": [],
            }

        # Run the existing scheduler logic.
        success, output, final_response, error = run_job(job)

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
async def save_cron_output(job_id: str, output: str) -> Dict[str, Any]:
    """Save job output to the cron output directory."""
    try:
        from cron.jobs import save_job_output

        path = save_job_output(job_id, output)
        return {"success": True, "path": str(path)}
    except Exception as exc:
        logger.exception("save_cron_output activity failed for %s", job_id)
        return {"success": False, "error": str(exc)}


@activity.defn
async def deliver_cron_result(
    job_id: str, content: str, success: bool
) -> Dict[str, Any]:
    """Deliver job result to configured target(s).

    Uses the existing _deliver_result() from scheduler.py.
    """
    try:
        from cron.scheduler import SILENT_MARKER, _deliver_result
        from cron.jobs import get_job

        job = get_job(job_id)
        if job is None:
            return {"success": True}  # Nothing to deliver without a job record

        # Respect [SILENT] marker — skip delivery but output already saved.
        stripped = content.strip()
        if success and SILENT_MARKER in stripped.upper():
            logger.info("Job '%s': agent returned %s — skipping delivery", job_id, SILENT_MARKER)
            return {"success": True}

        # Build deliverable content (error alert for failed jobs).
        job_name = job.get("name", job_id)
        if not success:
            error_part = ""
            if "## Error" in content:
                error_part = content.split("## Error")[-1].strip()
            deliver_content = (
                f"\u26a0\ufe0f Cron job '{job_name}' failed:\n{error_part or 'See logs for details'}"
            )
        else:
            deliver_content = stripped if stripped else ""

        if not deliver_content:
            return {"success": True}

        delivery_error = _deliver_result(job, deliver_content)
        if delivery_error:
            return {"success": False, "error": delivery_error}
        return {"success": True}

    except Exception as exc:
        logger.exception("deliver_cron_result activity failed for %s", job_id)
        return {"success": False, "error": str(exc)}


@activity.defn
async def mark_job_run_activity(
    job_id: str, success: bool, error: Optional[str] = None
) -> Dict[str, Any]:
    """Mark a job as having been run (updates jobs.json metadata)."""
    try:
        from cron.jobs import mark_job_run

        mark_job_run(job_id, success, error=error)
        return {"success": True}
    except Exception as exc:
        logger.exception("mark_job_run_activity failed for %s", job_id)
        return {"success": False, "error": str(exc)}


@activity.defn
async def trigger_on_success_jobs(job_id: str, on_success_ids: List[str]) -> Dict[str, Any]:
    """Trigger dependent jobs listed in on_success after a successful run.

    Starts new Temporal workflow runs for each target job.
    """
    try:
        from cron.jobs import get_job

        triggered = []
        skipped = []

        for target_id in on_success_ids:
            if target_id == job_id:
                continue  # Prevent self-triggering

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
                    from cron.jobs import trigger_job
                    trigger_job(target_id)
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
#   cron/__init__.py → cron.jobs → croniter → platform → subprocess (blocked)
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
      - Convert jobs.json schedule kinds → Temporal Schedule specs
      - Register / update / remove Temporal schedules for each job
      - Start the Temporal worker that executes CronJobWorkflow + activities
      - Provide graceful fallback to file-based tick() when Temporal is down

    Usage:
        bridge = TemporalCronBridge.get_instance()
        if bridge.is_available():
            await bridge.sync_schedules()  # Align jobs.json → Temporal schedules
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
    # Schedule conversion: jobs.json → Temporal schedules
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
            from cron.jobs import list_jobs, load_jobs

            all_jobs = [j for j in load_jobs()]  # Include disabled for cleanup
            active_jobs = list_jobs(include_disabled=False)

            report = {
                "created": [],
                "updated": [],
                "removed": [],
                "skipped_oneshot": [],
                "errors": [],
            }

            # Build set of expected schedule IDs.
            expected_ids: set[str] = set()
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

                await self._upsert_schedule(job, temporal_spec)
                report["created"].append(job["id"])

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
            err_lower = str(exc).lower()
            if "not found" in err_lower or "does not exist" in err_lower:
                try:
                    await self._client.create_schedule(sid, schedule)
                except Exception:
                    pass  # Race condition: another bridge instance created it.
            else:
                logger.warning("Failed to upsert schedule %s: %s", sid, exc)

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
        """Start a CronJobWorkflow immediately for a specific job.

        Returns the workflow execution ID, or None on failure.
        """
        if not await self.ensure_connected():
            return None

        try:
            handle = await self._client.start_workflow(
                "CronJobWorkflow",
                args=[job_id],
                id=f"cron-job-{job_id}-{self._run_timestamp()}",
                task_queue=TEMPORAL_TASK_QUEUE,
                execution_timeout=DEFAULT_EXECUTION_TIMEOUT,
                run_timeout=timedelta(minutes=30),
                task_timeout=timedelta(minutes=5),
            )
            logger.info("Started immediate workflow for job %s: %s", job_id, handle.id)
            return handle.id
        except Exception as exc:
            logger.error("Failed to start workflow for job %s: %s", job_id, exc)
            return None

    @staticmethod
    def _run_timestamp() -> str:
        """Return a compact timestamp string for unique workflow IDs."""
        from datetime import datetime
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
        from cron.jobs import trigger_job
        result = trigger_job(job_id)
        return {
            "method": "fallback_tick",
            "job_id": job_id,
            "result": result is not None,
        }

    try:
        from cron.jobs import get_job
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
        from cron.jobs import trigger_job
        trigger_job(job_id)
        return {
            "method": "fallback_tick_after_error",
            "job_id": job_id,
            "error": str(exc),
        }


async def bridge_tick(verbose: bool = True) -> int:
    """Bridge version of tick() — routes through Temporal when available.

    If Temporal is connected and schedules are synced, this is a no-op because
    Temporal handles execution autonomously. Returns 0 to indicate "handled by Temporal".

    Falls back to the existing file-based tick() if Temporal is unavailable.
    """
    bridge = TemporalCronBridge.get_instance()

    if not bridge or not await bridge.ensure_connected():
        logger.info("bridge_tick: Temporal unavailable, falling back to tick()")
        from cron.scheduler import tick as _tick
        return _tick(verbose=verbose)

    # Ensure schedules are in sync.
    report = await bridge.sync_schedules()
    if "error" in report:
        logger.warning("bridge_tick: schedule sync failed (%s), falling back to tick()", report["error"])
        from cron.scheduler import tick as _tick
        return _tick(verbose=verbose)

    # Temporal is handling execution — nothing for us to do.
    if verbose:
        logger.info("bridge_tick: Temporal managing schedules (synced %d jobs)", len(report.get("created", [])))
    return 0


def cronjob_bridge_create_job(**kwargs) -> Dict[str, Any]:
    """Create a job and optionally register it with Temporal.

    Wraps create_job() from jobs.py, then syncs the schedule if Temporal is available.
    Returns the created job dict.
    """
    from cron.jobs import create_job as _create_job

    job = _create_job(**kwargs)

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


def cronjob_bridge_remove_job(job_id: str) -> bool:
    """Remove a job from both jobs.json and Temporal schedules."""
    # Remove from Temporal first (best-effort).
    bridge = TemporalCronBridge.get_instance()
    if bridge and HAS_TEMPORAL:
        try:
            asyncio.run(bridge.remove_schedule(job_id))
        except Exception as exc:
            logger.debug("Failed to remove Temporal schedule for %s: %s", job_id, exc)

    # Remove from jobs.json.
    from cron.jobs import remove_job as _remove_job
    return _remove_job(job_id)


def cronjob_bridge_trigger_job(job_id: str) -> Dict[str, Any]:
    """Trigger a job immediately through Temporal (or fallback)."""
    bridge = TemporalCronBridge.get_instance()

    if not bridge or not HAS_TEMPORAL:
        from cron.jobs import trigger_job as _trigger_job
        result = _trigger_job(job_id)
        return {"method": "fallback_tick", "job_id": job_id, "ok": result is not None}

    async def _do_trigger():
        wf_id = await bridge.trigger_job_immediate(job_id)
        if wf_id:
            return {"method": "temporal_workflow", "job_id": job_id, "workflow_id": wf_id}
        # Fallback.
        from cron.jobs import trigger_job as _trigger_job
        _trigger_job(job_id)
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
        from cron.jobs import trigger_job as _trigger_job
        _trigger_job(job_id)
        return {"method": "fallback_tick", "job_id": job_id, "ok": True}
