# Messaging Gateway Guide

The messaging gateway lets Autolycus run as a bot across multiple platforms simultaneously from a single process. Conversations maintain continuity regardless of which platform you use.

## Starting the Gateway

```bash
lycus gateway setup      # Interactive gateway configuration
lycus gateway start       # Start gateway service
lycus gateway stop        # Stop gateway service
lycus gateway status      # Check if running
lycus gateway install     # Install as systemd user service
lycus gateway uninstall   # Remove the service
```

## Supported Platforms

The gateway includes adapters for:

| Platform | File | Notes |
|----------|------|-------|
| Telegram | `telegram.py` | Full Bot API support, topics/forums |
| Discord | (built-in) | Standard bot integration |
| Slack | `slack.py` | Uses `!` prefix instead of `/` for commands |
| WhatsApp | `whatsapp.py`, `whatsapp_cloud.py` | Personal + Cloud API |
| Signal | `signal.py` | Rate-limited, uses libsignal |
| Email | `email.py` | IMAP/SMTP integration |
| Matrix | `matrix.py` | Uses `!` prefix for commands |
| SMS | `sms.py` | Direct SMS gateway |
| Webhook | `webhook.py` | HTTP-triggered sessions (restricted toolset) |
| BlueBubbles | `bluebubbles.py` | iMessage bridge |
| Feishu/Lark | `feishu.py` | Chinese enterprise platform |
| WeChat/Weixin | `weixin.py` | Chinese messaging |
| QQ Bot | `qqbot/adapter.py` | Tencent QQ |
| DingTalk | `dingtalk.py` | Alibaba workplace |
| WeCom | `wecom.py` | Enterprise WeChat |
| Yuanbao | `yuanbao.py` | Baidu Yuanbao groups |

## Configuration

Gateway settings live in `config.yaml`:

```yaml
gateway:
  platforms:
    telegram:
      token: "YOUR_BOT_TOKEN"
      allowed_users: ["@username1", "@username2"]
    discord:
      token: "YOUR_DISCORD_BOT_TOKEN"
      guild_id: "123456789"
```

Platform tokens are stored in `~/.autolycus/.env` during setup.

## Cross-Platform Continuity

Sessions are keyed by user identity, not platform. The same conversation persists whether you switch between Telegram, Discord, or the CLI -- the agent maintains context across platforms.

## Slash Commands in Messaging

Most slash commands work identically across platforms:

| Command | Description |
|---------|-------------|
| `/new` or `/reset` | Start fresh conversation |
| `/model [provider:model]` | Change model |
| `/personality [name]` | Set personality |
| `/retry`, `/undo` | Retry/undo last turn |
| `/compress`, `/usage` | Context management |
| `/skills` or `/<skill-name>` | Browse/load skills |
| `/stop` | Interrupt current work |

**Platform-specific prefixes:** Slack and Matrix use `!command` instead of `/command` because their platforms reserve the `/` prefix. The gateway automatically rewrites these on receive.

## Webhook Integration

Webhooks trigger sessions from HTTP POST requests with a restricted, safe toolset (web search, content extraction, vision analysis only) to prevent prompt injection through untrusted third-party content.

```yaml
gateway:
  platforms:
    webhook:
      enabled: true
      secret: "your-webhook-secret"
```

## Home Channel

Each platform has a designated "home channel" where the agent posts by default. Set it with `/sethome` in the messaging interface.
