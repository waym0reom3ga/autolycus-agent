#!/usr/bin/env python3
"""Test script for Lycus communication module."""

import asyncio
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from comm.tools import LycusCommTools, CommToolConfig


async def test_communication():
    """Test the communication module end-to-end."""
    
    print("=== Testing Lycus Communication Module ===\n")
    
    # Create config for local homeserver
    config = CommToolConfig(
        homeserver_url="http://localhost:8008",
        username="lycus",
        password="lycus-dev-password",
        device_id="LYCUS1",
        agent_room="#lycus-agents:lycus.local"
    )
    
    # Initialize tools
    tools = LycusCommTools(config)
    
    print("✓ Tools initialized")
    
    # Start the module
    await tools.start()
    print("✓ Communication module started")
    
    # Register local agent
    await tools.register_agent("terra", "Terra Agent", ["messaging", "cron"])
    print("✓ Local agent registered as 'terra'")
    
    # List agents
    agents = tools.list_agents()
    print(f"✓ Known agents: {agents}")
    
    # Test message sending (simulated for now)
    result = await tools.send_message("@nova:lycus.local", "Hello from Terra!")
    print(f"✓ Message sent: {result}")
    
    print("\n=== All tests passed ===")
    
    # Cleanup
    await tools.stop()


if __name__ == "__main__":
    asyncio.run(test_communication())
