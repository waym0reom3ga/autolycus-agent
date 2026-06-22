# Tools and Toolsets Guide

Autolycus provides 40+ built-in tools organized into composable toolsets. Every tool is sent to the model on every API call, so the core toolset is kept lean -- new capabilities should arrive as skills or plugins rather than core tools.

## Available Tools

### Web
| Tool | Description |
|------|-------------|
| `web_search` | Search the web via SearXNG |
| `web_extract` | Extract content from URLs to markdown |

### Terminal and Process Management
| Tool | Description |
|------|-------------|
| `terminal` | Execute shell commands (local, SSH, Docker backends) |
| `process` | Manage background processes (list, poll, wait, kill) |
| `read_terminal` | Read desktop GUI terminal pane (gated on HERMES_DESKTOP) |

### File Operations
| Tool | Description |
|------|-------------|
| `read_file` | Read files with line numbers and pagination |
| `write_file` | Write complete file contents |
| `patch` | Targeted find-and-replace edits (V4A format) |
| `search_files` | Ripgrep-backed content and filename search |

### Vision and Image Generation
| Tool | Description |
|------|-------------|
| `vision_analyze` | Analyze images with vision models |
| `image_generate` | Generate images from text prompts |

### Browser Automation
| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URLs |
| `browser_snapshot` | Get page accessibility tree |
| `browser_click` | Click elements by reference ID |
| `browser_type` | Type text into input fields |
| `browser_scroll` | Scroll page up/down |
| `browser_back` | Navigate back in history |
| `browser_press` | Press keyboard keys |
| `browser_get_images` | List all images on the page |
| `browser_vision` | Take screenshots for visual inspection |
| `browser_console` | Read browser console output / evaluate JavaScript |
| `browser_cdp` | Chrome DevTools Protocol access |
| `browser_dialog` | Handle browser dialogs (alert, confirm, prompt) |

### Skills System
| Tool | Description |
|------|-------------|
| `skills_list` | List available skills with metadata |
| `skill_view` | Load full skill content or linked files |
| `skill_manage` | Create, update, delete skills |

### Planning and Memory
| Tool | Description |
|------|-------------|
| `todo` | Manage task lists within a session |
| `memory` | Persistent cross-session memory (add/replace/remove) |
| `session_search` | Search past conversations via FTS5 |

### Code Execution and Delegation
| Tool | Description |
|------|-------------|
| `execute_code` | Run Python scripts with tool access |
| `delegate_task` | Spawn isolated subagents for parallel work |

### Scheduling and Messaging
| Tool | Description |
|------|-------------|
| `cronjob` | Manage scheduled tasks (create/list/pause/remove/run) |
| `send_message` | Send messages to connected platforms |
| `text_to_speech` | Generate speech from text |

### Smart Home (Home Assistant)
| Tool | Description |
|------|-------------|
| `ha_list_entities` | List Home Assistant entities |
| `ha_get_state` | Get entity state |
| `ha_list_services` | List available services |
| `ha_call_service` | Call a Home Assistant service |

### Kanban Multi-Agent Coordination
| Tool | Description |
|------|-------------|
| `kanban_show`, `kanban_list` | View kanban board state |
| `kanban_complete`, `kanban_block` | Update task status |
| `kanban_heartbeat` | Report worker progress |
| `kanban_comment`, `kanban_create`, `kanban_link` | Task management |

### Computer Use (macOS)
| Tool | Description |
|------|-------------|
| `computer_use` | Desktop control via cua-driver (gated on installation) |

## Toolsets

Toolsets group tools for specific scenarios. Configure in `config.yaml`:

```yaml
toolsets:
  - web           # web_search, web_extract
  - terminal      # terminal, process
  - file          # read_file, write_file, patch, search_files
  - browser       # Full browser automation suite
  - skills        # skills_list, skill_view, skill_manage
  - memory        # Persistent memory operations
  - delegation    # delegate_task (subagent spawning)
  - cronjob       # Scheduled task management
```

### Built-in Toolsets

| Toolset | Description |
|---------|-------------|
| `web` | Web research and content extraction |
| `search` | Web search only (no scraping) |
| `terminal` | Shell command execution and process management |
| `file` | File read/write/search operations |
| `browser` | Full browser automation |
| `skills` | Skill system access |
| `memory` | Persistent memory and session search |
| `delegation` | Subagent spawning |
| `cronjob` | Scheduled task management |
| `messaging` | Cross-platform messaging |

### Service-Gated Tools

Some tools are only available when their dependency is configured:

- **Home Assistant tools**: Require `HASS_TOKEN` in `.env`
- **Computer use**: Requires cua-driver installation (macOS)
- **Kanban tools**: Only active when spawned as a kanban worker or profile enables the toolset
- **Messaging (`send_message`)**: Gated on gateway being running

## Terminal Backends

The `terminal` tool supports multiple execution backends:

| Backend | Description |
|---------|-------------|
| `local` | Commands run on the local machine (default) |
| `ssh` | Remote SSH execution |
| `docker` | Containerized execution |
| `modal` | Serverless GPU cloud (Modal.com) |
| `daytona` | Sandboxed development environments |

Configure in `config.yaml`:

```yaml
terminal:
  backend: local
```

## Managing Tools

```bash
lycus tools              # Show enabled toolsets
lycus tools enable web   # Enable a specific toolset
lycus tools disable browser  # Disable a toolset
```
