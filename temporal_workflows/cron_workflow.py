"""Temporal workflows for Lycus cron job orchestration.

This module lives OUTSIDE the cron package to avoid triggering the import chain:
  cron/__init__.py → cron.jobs → croniter → platform → subprocess (sandbox violation)

The workflow is pure orchestration — all heavy lifting happens in activities
defined in cron.temporal_bridge which run outside the Temporal sandbox.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, List

from temporalio import workflow
from temporalio.common import RetryPolicy

logger = logging.getLogger(__name__)

# Import activities from the bridge module inside the unsafe block so they are
# accessible at runtime but not serialized into the workflow code.
with workflow.unsafe.imports_passed_through():
    from cron.temporal_bridge import (  # noqa: F401
        execute_cron_job,
        save_cron_output,
        deliver_cron_result,
        mark_job_run_activity,
        trigger_on_success_jobs,
    )

# Workflow-level timeouts
DEFAULT_EXECUTION_TIMEOUT = timedelta(hours=2)
DEFAULT_HEARTBEAT_TIMEOUT = timedelta(seconds=30)


@workflow.defn(name="CronJobWorkflow")
class CronJobWorkflow:
    """Temporal workflow that orchestrates one execution of a cron job.

    Steps:
      1. Execute the job (activity → existing run_job logic)
      2. Save output to file
      3. Deliver result if applicable
      4. Mark job as run in jobs.json
      5. Trigger on_success dependent jobs

    Temporal handles retries, heartbeats, and crash recovery automatically.

    NOTE: This workflow must NOT import any non-deterministic modules directly.
    All heavy lifting (cron module imports, file I/O, subprocess calls) is
    delegated to activities which run outside the sandbox. The workflow code
    here is pure orchestration logic only.
    """

    @workflow.run
    async def run(self, job_id: str) -> Dict[str, Any]:
        # Step 1: Execute the job with retry policy.
        exec_result = await workflow.execute_activity(
            execute_cron_job,
            arg=job_id,
            start_to_close_timeout=DEFAULT_EXECUTION_TIMEOUT,
            retry_policy=RetryPolicy(
                maximum_attempts=1,  # Don't re-run agent logic on failure.
                initial_interval=timedelta(seconds=5),
            ),
        )

        success = exec_result.get("success", False)
        output = exec_result.get("output", "")
        final_response = exec_result.get("final_response", "")
        error = exec_result.get("error")

        # Step 2: Save output.
        save_result = await workflow.execute_activity(
            save_cron_output,
            args=[job_id, output],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        # Step 3: Deliver result.
        deliver_result = await workflow.execute_activity(
            deliver_cron_result,
            args=[job_id, final_response, success],
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # Step 4: Mark job as run.
        mark_error = error if not success else None
        await workflow.execute_activity(
            mark_job_run_activity,
            args=[job_id, success, mark_error],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        # Step 5: Trigger on_success chains.
        # We pass the on_success IDs from the exec_result (populated by the activity).
        on_success_ids = exec_result.get("on_success", []) or []
        if on_success_ids and success:
            await workflow.execute_activity(
                trigger_on_success_jobs,
                args=[job_id, list(on_success_ids)],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )

        return {
            "job_id": job_id,
            "success": success,
            "error": error,
            "save_ok": save_result.get("success", False),
            "deliver_ok": deliver_result.get("success", False),
        }
