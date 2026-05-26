"""
Lycus Communication Bridge

Bridges Matrix messages to the Python cron system via Unix socket IPC.
Incoming Matrix messages trigger agent runs through the cron scheduler.
"""

import asyncio
import json
import logging
import socket
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_SOCKET_PATH = "/tmp/lycus-cron-bridge.sock"


class LycusCommBridge:
    """Bridge between Rust Matrix client and Python cron system."""
    
    def __init__(self, socket_path: str = DEFAULT_SOCKET_PATH):
        self.socket_path = socket_path
        self.server: Optional[asyncio.UnixServer] = None
        self.running = False
        
    async def start(self):
        """Start the Unix socket server to receive cron triggers."""
        self.server = await asyncio.start_unix_server(
            self._handle_trigger,
            path=self.socket_path,
        )
        self.running = True
        logger.info("Lycus comm bridge started on %s", self.socket_path)
        
    async def stop(self):
        """Stop the bridge server."""
        self.running = False
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        logger.info("Lycus comm bridge stopped")
        
    async def _handle_trigger(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Handle incoming cron trigger from Rust Matrix client."""
        try:
            data = await reader.read(65536)
            if not data:
                return
                
            trigger = json.loads(data.decode('utf-8'))
            logger.info("Received trigger from agent: %s", trigger.get('source_agent'))
            
            # Forward to cron system
            await self._forward_to_cron(trigger)
            
            # Send acknowledgment
            writer.write(json.dumps({"status": "ok"}).encode('utf-8'))
            await writer.drain()
            
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON from comm bridge: %s", e)
            writer.write(json.dumps({"status": "error", "message": "invalid json"}).encode('utf-8'))
            await writer.drain()
        except Exception as e:
            logger.error("Error handling trigger: %s", e)
            writer.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            await writer.drain()
            
    async def _forward_to_cron(self, trigger: dict):
        """Forward the trigger to the cron scheduler."""
        # Import here to avoid circular imports
        from cron.scheduler import run_job
        from cron.jobs import load_jobs
        
        # Create a cron job from the incoming message
        job = {
            "id": f"matrix_{int(time.time())}",
            "name": f"Matrix message from {trigger.get('source_agent', 'unknown')}",
            "prompt": trigger.get('message', ''),
            "skills": trigger.get('skill') or [],
            "schedule": "once",
            "enabled": True,
            "origin": {
                "platform": "matrix",
                "chat_id": trigger.get('source_agent', ''),
            },
        }
        
        # Run the job
        try:
            success, output, final_response, error = run_job(job)
            logger.info("Matrix-triggered job completed: success=%s", success)
        except Exception as e:
            logger.error("Matrix-triggered job failed: %s", e)


async def main():
    """Run the bridge standalone for testing."""
    bridge = LycusCommBridge()
    await bridge.start()
    
    try:
        # Run forever
        while True:
            await asyncio.sleep(3600)
    except KeyboardInterrupt:
        await bridge.stop()


if __name__ == "__main__":
    asyncio.run(main())
