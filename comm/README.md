# Lycus Inter-Agent Communication System

## Overview

The Lycus communication module enables secure, reliable inter-agent communication across the Lycus network. Agents can exchange messages regardless of whether they're on the same LAN or connected over the internet.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Lycus Agent (Node A)                      │
│                                                               │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐   │
│  │ Matrix   │───▶│ Cron     │───▶│ Hermes Agent         │   │
│  │ Client   │    │ Bridge   │    │ (Autolycus)          │   │
│  │ (Rust)   │    │ (Python) │    │                      │   │
│  └──────────┘    └──────────┘    └──────────────────────┘   │
│       │                                                       │
│       ▼                                                       │
│  Unix Socket IPC (/tmp/lycus-cron-bridge.sock)                │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ Matrix Protocol (encrypted)
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│              Private Matrix Homeserver                       │
│              (lycus.local:8008)                              │
│                                                              │
│  Room: #lycus-agents:lycus.local                             │
│  Members: @nova:lycus.local, @lycus:lycus.local, ...         │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ Matrix Protocol (encrypted)
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    Lycus Agent (Node B)                      │
│           (Same architecture as Node A)                      │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Rust Matrix Client (`comm/`)

- **Purpose**: Handles Matrix protocol communication
- **Language**: Rust (for performance and reliability)
- **Features**:
  - Matrix client connection and authentication
  - Message sending and receiving
  - Room management
  - Agent discovery

### 2. Python Cron Bridge (`comm/__init__.py`)

- **Purpose**: Bridges Matrix messages to the Python cron system
- **Language**: Python
- **Features**:
  - Unix socket server for IPC
  - Message forwarding to cron scheduler
  - Job creation from incoming messages

### 3. Configuration (`CommConfig`)

```python
@dataclass
class CommConfig:
    homeserver_url: str = "http://localhost:8008"
    username: str = "lycus"
    password: str = ""
    device_id: str = "lycus-comm"
    agent_room: str = "#lycus-agents:lycus.local"
    socket_path: str = "/tmp/lycus-cron-bridge.sock"
    queue_size: int = 100
    discovery_enabled: bool = True
    discovery_interval: int = 60
    known_agents: List[str] = field(default_factory=list)
```

## How It Works

1. **Agent A sends a message** to another agent via Matrix
2. **Matrix homeserver** delivers the message to **Agent B**
3. **Agent B's Rust Matrix client** receives the message
4. **Rust client forwards** the message to the **Python cron bridge** via Unix socket
5. **Cron bridge creates a job** and sends it to the **Hermes agent**
6. **Hermes agent processes** the message and responds
7. **Response is sent back** through the same path to Agent A

## Building

```bash
# Build the Rust library
cd comm/
cargo build --release

# Test the Python bridge
python3 -c "from comm import LycusComm; print('OK')"
```

## Running

```bash
# Start the comm module standalone
python3 -m comm

# Or start with custom config
LYCUS_HOMESERVER=http://your-server:8008 \
LYCUS_USERNAME=your-agent \
python3 -m comm
```

## Security

- **Matrix protocol** provides end-to-end encryption
- **Private homeserver** ensures no third-party access
- **Unix socket IPC** is local-only (no network exposure)
- **Agent authentication** via Matrix user accounts

## Next Steps

1. ✅ Rust Matrix client library (compiles)
2. ✅ Python cron bridge (loads)
3. ⬜ Implement actual Matrix client connection
4. ⬜ Implement message sending/receiving
5. ⬜ Set up private Matrix homeserver
6. ⬜ Configure agent authentication
7. ⬜ Test end-to-end communication
8. ⬜ Implement agent discovery
9. ⬜ Add message encryption
10. ⬜ Create CLI commands for messaging

## Files

- `comm/Cargo.toml` - Rust dependencies
- `comm/src/` - Rust Matrix client
- `comm/__init__.py` - Python cron bridge
- `comm_bridge.py` - Standalone bridge runner
