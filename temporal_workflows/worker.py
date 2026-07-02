"""Temporal worker for Andon light workflows."""

import asyncio
from temporalio.client import Client
from temporalio.worker import Worker

from .workflow import AndonLightWorkflow
from . import activities


async def start_worker(
    target_host: str = "127.0.0.1",
    target_port: int = 7233,
    namespace: str = "default",
) -> Worker:
    """Start the Temporal worker for Andon light workflows."""

    # Connect to Temporal server
    client = await Client.connect(
        f"{target_host}:{target_port}",
        namespace=namespace,
    )

    # Create worker
    worker = Worker(
        client,
        task_queue="andon-light",
        workflows=[AndonLightWorkflow],
        activities=[
            activities.flash_green_once,
            activities.flash_yellow_three_times,
            activities.set_solid_red,
            activities.turn_off_light,
        ],
    )

    print(f"Temporal worker connected to {target_host}:{target_port}")
    return worker


async def run_worker(
    target_host: str = "127.0.0.1",
    target_port: int = 7233,
    namespace: str = "default",
) -> None:
    """Run the Temporal worker until interrupted."""
    worker = await start_worker(target_host, target_port, namespace)

    try:
        await worker.run()
    except KeyboardInterrupt:
        print("Worker stopped.")


def main():
    """CLI entry point for running the worker."""
    import argparse

    parser = argparse.ArgumentParser(description="Run Andon light Temporal worker")
    parser.add_argument("--host", default="127.0.0.1", help="Temporal server host")
    parser.add_argument("--port", type=int, default=7233, help="Temporal server port")
    parser.add_argument("--namespace", default="default", help="Temporal namespace")

    args = parser.parse_args()
    asyncio.run(run_worker(args.host, args.port, args.namespace))


if __name__ == "__main__":
    main()
