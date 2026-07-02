"""CLI tool to send signals to the Andon light workflow."""

import asyncio
from temporalio.client import Client

from .workflow import AndonLightWorkflow, TaskSignal, LightState


async def signal_task_start(
    task_id: str = "default",
    host: str = "127.0.0.1",
    port: int = 7233,
) -> None:
    """Signal that a task has started (flash green)."""
    client = await Client.connect(f"{host}:{port}")

    # Start workflow if not already running
    handle = await client.start_workflow(
        AndonLightWorkflow.run,
        id=f"andon-light-{task_id}",
        task_queue="andon-light",
    )

    # Signal the state change
    await handle.signal(
        AndonLightWorkflow.set_state,
        TaskSignal(LightState.TASK_STARTED, task_id),
    )
    print(f"Task {task_id} started — green flash sent")


async def signal_task_finished(
    task_id: str = "default",
    host: str = "127.0.0.1",
    port: int = 7233,
) -> None:
    """Signal that a task has finished (flash yellow + solid red)."""
    client = await Client.connect(f"{host}:{port}")

    handle = client.get_workflow_handle(workflow_id=f"andon-light-{task_id}")

    # Signal the state change
    await handle.signal(
        AndonLightWorkflow.set_state,
        TaskSignal(LightState.TASK_FINISHED, task_id),
    )
    print(f"Task {task_id} finished — yellow flash + solid red sent")


async def signal_error(
    host: str = "127.0.0.1",
    port: int = 7233,
) -> None:
    """Signal error state (solid red)."""
    client = await Client.connect(f"{host}:{port}")

    handle = client.get_workflow_handle(workflow_id="andon-light-default")
    await handle.signal(
        AndonLightWorkflow.set_state,
        TaskSignal(LightState.ERROR),
    )
    print("Error signaled — solid red set")


def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Control Andon light via Temporal")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Start task
    start_parser = subparsers.add_parser("start", help="Signal task started (green flash)")
    start_parser.add_argument("--task-id", default="default", help="Task ID")
    start_parser.add_argument("--host", default="127.0.0.1", help="Temporal host")
    start_parser.add_argument("--port", type=int, default=7233, help="Temporal port")

    # Finish task
    finish_parser = subparsers.add_parser("finish", help="Signal task finished (yellow + red)")
    finish_parser.add_argument("--task-id", default="default", help="Task ID")
    finish_parser.add_argument("--host", default="127.0.0.1", help="Temporal host")
    finish_parser.add_argument("--port", type=int, default=7233, help="Temporal port")

    # Error
    error_parser = subparsers.add_parser("error", help="Signal error (solid red)")
    error_parser.add_argument("--host", default="127.0.0.1", help="Temporal host")
    error_parser.add_argument("--port", type=int, default=7233, help="Temporal port")

    args = parser.parse_args()

    if args.command == "start":
        asyncio.run(signal_task_start(args.task_id, args.host, args.port))
    elif args.command == "finish":
        asyncio.run(signal_task_finished(args.task_id, args.host, args.port))
    elif args.command == "error":
        asyncio.run(signal_error(args.host, args.port))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
