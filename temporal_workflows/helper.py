"""Helper for triggering Andon light signals from within Lycus agent."""

import asyncio
from temporalio.client import Client

from .workflow import AndonLightWorkflow, TaskSignal, LightState


async def trigger_task_start(
    task_id: str = "default",
    host: str = "127.0.0.1",
    port: int = 7233,
) -> None:
    """Call this when a task starts — flashes green once."""
    client = await Client.connect(f"{host}:{port}")
    handle = await client.start_workflow(
        AndonLightWorkflow.run,
        id=f"andon-light-{task_id}",
        task_queue="andon-light",
    )
    await handle.signal(
        AndonLightWorkflow.set_state,
        TaskSignal(LightState.TASK_STARTED, task_id),
    )


async def trigger_task_finished(
    task_id: str = "default",
    host: str = "127.0.0.1",
    port: int = 7233,
) -> None:
    """Call this when a task finishes — flashes yellow then solid red."""
    client = await Client.connect(f"{host}:{port}")
    handle = client.get_workflow_handle(workflow_id=f"andon-light-{task_id}")
    await handle.signal(
        AndonLightWorkflow.set_state,
        TaskSignal(LightState.TASK_FINISHED, task_id),
    )


def task_start(task_id: str = "default", **kwargs) -> None:
    """Synchronous wrapper for agent use."""
    asyncio.run(trigger_task_start(task_id, **kwargs))


def task_finished(task_id: str = "default", **kwargs) -> None:
    """Synchronous wrapper for agent use."""
    asyncio.run(trigger_task_finished(task_id, **kwargs))
