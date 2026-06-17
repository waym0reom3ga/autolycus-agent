"""
Shared platform registry for Lycus Agent.

Single source of truth for platform metadata consumed by both
skills_config (label display) and tools_config (default toolset
resolution).  Import ``PLATFORMS`` from here instead of maintaining
duplicate dicts in each module.
"""

from collections import OrderedDict
from typing import NamedTuple


class PlatformInfo(NamedTuple):
    """Metadata for a single platform entry."""
    label: str
    default_toolset: str


# Ordered so that TUI menus are deterministic.
PLATFORMS: OrderedDict[str, PlatformInfo] = OrderedDict([
    ("cli",            PlatformInfo(label="🖥️  CLI",            default_toolset="lycus-cli")),
    ("telegram",       PlatformInfo(label="📱 Telegram",        default_toolset="lycus-telegram")),
    ("discord",        PlatformInfo(label="💬 Discord",         default_toolset="lycus-discord")),
    ("slack",          PlatformInfo(label="💼 Slack",           default_toolset="lycus-slack")),
    ("whatsapp",       PlatformInfo(label="📱 WhatsApp",        default_toolset="lycus-whatsapp")),
    ("whatsapp_cloud", PlatformInfo(label="📱 WhatsApp Business (Cloud)", default_toolset="lycus-whatsapp")),
    ("signal",         PlatformInfo(label="📡 Signal",          default_toolset="lycus-signal")),
    ("bluebubbles",    PlatformInfo(label="💙 BlueBubbles",     default_toolset="lycus-bluebubbles")),
    ("email",          PlatformInfo(label="📧 Email",           default_toolset="lycus-email")),
    ("homeassistant",  PlatformInfo(label="🏠 Home Assistant",  default_toolset="lycus-homeassistant")),
    ("mattermost",     PlatformInfo(label="💬 Mattermost",      default_toolset="lycus-mattermost")),
    ("matrix",         PlatformInfo(label="💬 Matrix",          default_toolset="lycus-matrix")),
    ("dingtalk",       PlatformInfo(label="💬 DingTalk",        default_toolset="lycus-dingtalk")),
    ("feishu",         PlatformInfo(label="🪽 Feishu",          default_toolset="lycus-feishu")),
    ("wecom",          PlatformInfo(label="💬 WeCom",           default_toolset="lycus-wecom")),
    ("wecom_callback", PlatformInfo(label="💬 WeCom Callback",  default_toolset="lycus-wecom-callback")),
    ("weixin",         PlatformInfo(label="💬 Weixin",          default_toolset="lycus-weixin")),
    ("qqbot",          PlatformInfo(label="💬 QQBot",           default_toolset="lycus-qqbot")),
    ("yuanbao",        PlatformInfo(label="🤖 Yuanbao",         default_toolset="lycus-yuanbao")),
    ("webhook",        PlatformInfo(label="🔗 Webhook",         default_toolset="lycus-webhook")),
    ("api_server",     PlatformInfo(label="🌐 API Server",      default_toolset="lycus-api-server")),
    ("cron",           PlatformInfo(label="⏰ Cron",            default_toolset="lycus-cron")),
])


def platform_label(key: str, default: str = "") -> str:
    """Return the display label for a platform key, or *default*.

    Checks the static PLATFORMS dict first, then the plugin platform
    registry for dynamically registered platforms.
    """
    info = PLATFORMS.get(key)
    if info is not None:
        return info.label
    # Check plugin registry
    try:
        from gateway.platform_registry import platform_registry
        entry = platform_registry.get(key)
        if entry:
            return f"{entry.emoji}  {entry.label}" if entry.emoji else entry.label
    except Exception:
        pass
    return default


def get_all_platforms() -> "OrderedDict[str, PlatformInfo]":
    """Return PLATFORMS merged with any plugin-registered platforms.

    Plugin platforms are appended after builtins.  This is the function
    that tools_config and skills_config should use for platform menus.
    """
    merged = OrderedDict(PLATFORMS)
    try:
        from gateway.platform_registry import platform_registry
        for entry in platform_registry.plugin_entries():
            if entry.name not in merged:
                merged[entry.name] = PlatformInfo(
                    label=f"{entry.emoji}  {entry.label}" if entry.emoji else entry.label,
                    default_toolset=f"lycus-{entry.name}",
                )
    except Exception:
        pass
    return merged
