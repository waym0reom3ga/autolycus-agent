# MCP Integration Guide

Autolycus supports the Model Context Protocol (MCP) for connecting external tool servers. MCP servers expose tools through a standardized protocol, which Autolycus discovers and registers automatically at startup.

## Configuration

MCP servers are configured in `~/.autolycus/config.yaml` under the `mcp_servers` key:

```yaml
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    env: {}
    display_name: "Filesystem Server"
  
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "ghp_..."
```

## Transport Modes

### Stdio (Default)

The most common transport -- Autolycus spawns the MCP server as a subprocess communicating over stdin/stdout:

```yaml
mcp_servers:
  my_server:
    command: npx
    args: ["-y", "some-mcp-server"]
```

### SSE (Server-Sent Events)

For remote MCP servers that expose an HTTP SSE endpoint:

```yaml
mcp_servers:
  remote_server:
    url: "http://localhost:8080/sse"
```

## Server Configuration Options

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable to run (stdio transport) |
| `args` | array | Command arguments |
| `env` | object | Environment variables for the subprocess |
| `url` | string | SSE endpoint URL (SSE transport) |
| `display_name` | string | Human-readable name shown in tool listings |

## How MCP Tools Work

1. At startup, Autolycus reads `mcp_servers` from config
2. Each server is spawned and its tools are discovered via the MCP protocol
3. Discovered tools are registered into the tool registry with a prefix matching the server name
4. The agent can call these tools just like built-in tools

## Security

MCP servers are validated at load time for suspicious patterns:

- Stdio commands that pipe to shell interpreters (`bash -c`, `python -c`) are flagged
- Commands attempting credential exfiltration are disabled automatically
- Disabled servers appear in logs with a warning message

To review or re-enable a disabled server, edit `config.yaml` directly.

## Reloading MCP Tools

During an active session, reload MCP tool definitions with `/reload-mcp`. By default this prompts for confirmation (controlled by `mcp_reload_confirm` in config). Reloading invalidates the prefix cache for the current conversation.

```yaml
mcp:
  mcp_reload_confirm: true    # Prompt before reloading (default)
```

## Inheritance for Subagents

When delegating tasks to subagents, MCP toolsets are inherited by default:

```yaml
delegation:
  inherit_mcp_toolsets: true   # Subagents get parent's MCP tools (default)
```

Set to `false` if you want subagents to have a restricted toolset without MCP access.

## Example: Popular MCP Servers

### Filesystem Access

```yaml
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
```

### GitHub Integration

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "ghp_..."
```

### Custom Python Server

```yaml
mcp_servers:
  my_tools:
    command: python3
    args: ["/path/to/my_mcp_server.py"]
```

## Troubleshooting

- **Server fails to start**: Check that the `command` executable is in your PATH and `args` are correct
- **Tools not appearing**: Run `lycus doctor` to check MCP server status
- **Security warnings**: Review disabled servers in logs, edit config.yaml to re-enable if trusted
