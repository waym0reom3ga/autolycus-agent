"""
Lycus Communication Module

Integrates Matrix-based inter-agent communication with the Autolycus cron system.
Each Lycus agent connects to a shared private homeserver and communicates through
dedicated Matrix rooms. Incoming messages trigger the internal cron system.

Usage:
    # Start the comm module
    python -m comm.main
    
    # Or integrate with gateway
    from comm import LycusComm
    comm = LycusComm()
    await comm.start()
"""

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class CommConfig:
    """Configuration for the communication module."""
    
    # Matrix homeserver settings
    homeserver_url: str = "http://localhost:8008"
    username: str = "lycus"
    password: str = ""
    device_id: str = "lycus-comm"
    
    # Agent room settings
    agent_room: str = "#lycus-agents:lycus.local"
    
    # Bridge settings
    socket_path: str = "/tmp/lycus-cron-bridge.sock"
    queue_size: int = 100
    
    # Discovery settings
    discovery_enabled: bool = True
    discovery_interval: int = 60
    known_agents: List[str] = field(default_factory=list)


class LycusComm:
    """Main communication module for Lycus agents."""
    
    def __init__(self, config: Optional[CommConfig] = None):
        self.config = config or CommConfig()
        self.running = False
        self.bridge: Optional[asyncio.Server] = None
        self.agents: Dict[str, dict] = {}
        
    async def start(self):
        """Start the communication module."""
        logger.info("Starting Lycus communication module")
        logger.info("Homeserver: %s", self.config.homeserver_url)
        logger.info("Username: %s", self.config.username)
        
        # Start the Unix socket bridge
        await self._start_bridge()
        
        # Start discovery if enabled
        if self.config.discovery_enabled:
            asyncio.create_task(self._discovery_loop())
        
        self.running = True
        logger.info("Lycus communication module started")
        
    async def stop(self):
        """Stop the communication module."""
        self.running = False
        if self.bridge:
            self.bridge.close()
            await self.bridge.wait_closed()
        logger.info("Lycus communication module stopped")
        
    async def _start_bridge(self):
        """Start the Unix socket bridge for cron triggers."""
        self.bridge = await asyncio.start_unix_server(
            self._handle_trigger,
            path=self.config.socket_path,
        )
        logger.info("Comm bridge listening on %s", self.config.socket_path)
        
    async def _handle_trigger(self, reader, writer):
        """Handle incoming trigger from Matrix client."""
        try:
            data = await reader.read(65536)
            if not data:
                return
                
            trigger = json.loads(data.decode('utf-8'))
            source = trigger.get('source_agent', 'unknown')
            message = trigger.get('message', '')
            
            logger.info("Received message from %s", source)
            
            # Forward to cron system
            await self._trigger_cron(source, message)
            
            # Send acknowledgment
            writer.write(json.dumps({"status": "ok"}).encode('utf-8'))
            await writer.drain()
            
        except Exception as e:
            logger.error("Error handling trigger: %s", e)
            writer.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            await writer.drain()
            
    async def _trigger_cron(self, source: str, message: str):
        """Trigger the cron system with the incoming message."""
        try:
            from cron.scheduler import run_job
            
            # Create a job from the incoming message
            job = {
                "id": f"matrix_{int(time.time())}",
                "name": f"Matrix message from {source}",
                "prompt": message,
                "schedule": "once",
                "enabled": True,
                "origin": {
                    "platform": "matrix",
                    "chat_id": source,
                },
            }
            
            # Run the job
            success, output, final_response, error = run_job(job)
            
            if success and final_response:
                logger.info("Job completed, response: %s", final_response[:200])
            else:
                logger.warning("Job failed: %s", error)
                
        except ImportError:
            logger.error("Cron scheduler not available - is Autolycus installed?")
        except Exception as e:
            logger.error("Failed to trigger cron: %s", e)
            
    async def _discovery_loop(self):
        """Periodically discover other agents."""
        while self.running:
            try:
                await self._discover_agents()
            except Exception as e:
                logger.error("Discovery error: %s", e)
            
            await asyncio.sleep(self.config.discovery_interval)
            
    async def _discover_agents(self):
        """Discover other Lycus agents on the network."""
        # TODO: Implement actual discovery via Matrix user directory
        # For now, just log
        logger.debug("Running agent discovery")
        
    async def send_message(self, target: str, message: str):
        """Send a message to another agent."""
        logger.info("Sending message to %s: %s", target, message[:100])
        # TODO: Implement actual Matrix message sending
        
    def list_agents(self) -> List[str]:
        """List known agents."""
        return list(self.agents.keys())


async def main():
    """Run the comm module standalone."""
    import signal
    
    # Load config from environment
    config = CommConfig(
        homeserver_url=os.getenv("LYCUS_HOMESERVER", "http://localhost:8008"),
        username=os.getenv("LYCUS_USERNAME", "lycus"),
        password=os.getenv("LYCUS_PASSWORD", ""),
    )
    
    comm = LycusComm(config)
    
    # Handle shutdown
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(comm.stop()))
    
    await comm.start()
    
    try:
        # Run forever
        while True:
            await asyncio.sleep(3600)
    except KeyboardInterrupt:
        await comm.stop()


if __name__ == "__main__":
    asyncio.run(main())
