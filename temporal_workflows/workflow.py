"""Temporal workflow for state-based Andon light scheduling."""

from datetime import timedelta
from enum import Enum
from typing import Optional

from temporalio import workflow
from temporalio.common import RetryPolicy

# Import activities inside workflow block to avoid serialization issues
with workflow.unsafe.imports_passed_through():
    from . import activities


class LightState(str, Enum):
    """States for the Andon light."""
    IDLE = "idle"
    TASK_STARTED = "task_started"
    TASK_FINISHED = "task_finished"
    ERROR = "error"


class TaskSignal:
    """Signal to change task state."""
    def __init__(self, new_state: LightState, task_id: Optional[str] = None):
        self.new_state = new_state
        self.task_id = task_id


@workflow.defn
class AndonLightWorkflow:
    """State-based workflow for controlling the Andon tower light.

    States:
    - IDLE: No active task, light is off
    - TASK_STARTED: Task in progress, flash green once
    - TASK_FINISHED: Task complete, flash yellow 3 times then solid red
    - ERROR: Error state, solid red
    """

    @workflow.run
    async def run(self) -> None:
        """Main workflow loop — waits for signals indefinitely."""
        self.current_state = LightState.IDLE
        self.task_id: Optional[str] = None

        # Turn off light on startup
        await workflow.execute_activity(
            activities.turn_off_light,
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        # Wait for signals indefinitely
        while True:
            # Wait for a signal
            await workflow.wait_condition(lambda: self.current_state != LightState.IDLE)

            if self.current_state == LightState.TASK_STARTED:
                await workflow.execute_activity(
                    activities.flash_green_once,
                    start_to_close_timeout=timedelta(seconds=10),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                # Return to idle after flashing
                self.current_state = LightState.IDLE

            elif self.current_state == LightState.TASK_FINISHED:
                await workflow.execute_activity(
                    activities.flash_yellow_three_times,
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                # Set solid red after flashing
                await workflow.execute_activity(
                    activities.set_solid_red,
                    start_to_close_timeout=timedelta(seconds=10),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                self.current_state = LightState.IDLE

            elif self.current_state == LightState.ERROR:
                await workflow.execute_activity(
                    activities.set_solid_red,
                    start_to_close_timeout=timedelta(seconds=10),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                # Stay in error state until manually reset

    @workflow.signal
    async def set_state(self, signal: TaskSignal) -> None:
        """Signal to change the light state."""
        self.current_state = signal.new_state
        self.task_id = signal.task_id
