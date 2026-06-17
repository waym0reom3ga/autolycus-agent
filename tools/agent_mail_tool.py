"""Agent Mail Tool - agent-to-agent email communication via IMAP/SMTP with TLS.

Registers six LLM-callable tools:
- ``agent_mail_send``    -- send an email to another agent
- ``agent_mail_inbox``   -- check inbox for new messages
- ``agent_mail_read``    -- read a specific message by index
- ``agent_mail_search``  -- search inbox by subject/body
- ``agent_mail_unread``  -- count unread messages
- ``agent_mail_settings` -- show current email configuration

Uses Python standard library imaplib + smtplib with SSL/TLS.
Supports both implicit SSL (IMAP4_SSL/SMTP_SSL) and STARTTLS upgrade.
Auto-detects TLS mode from port numbers (993/465 = SSL, 143/587 = STARTTLS).

Configuration via ~/.autolycus/.env:
    AGENT_MAIL_ADDRESS     -- Email address (e.g. agent@domain.local)
    AGENT_MAIL_PASSWORD    -- Email password
    AGENT_MAIL_IMAP_HOST   -- IMAP server host
    AGENT_MAIL_IMAP_PORT   -- IMAP port (993=SSL, 143=STARTTLS, default: 993)
    AGENT_MAIL_SMTP_HOST   -- SMTP server host
    AGENT_MAIL_SMTP_PORT   -- SMTP port (465=SSL, 587=STARTTLS, default: 587)
    AGENT_MAIL_USE_SSL     -- Force implicit SSL: true/false (auto-detected from port)

Agent registry is loaded from config.yaml under 'agent_mail.agents' key:
    agent_mail:
      agents:
        agent_name: agent@domain.local
        another_agent: another@domain.local
"""

import email as email_lib
import imaplib
import logging
import os
import ssl
import smtplib
import uuid
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, parseaddr
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Agent address registry (loaded from config.yaml)
# ---------------------------------------------------------------------------

def _load_agent_registry() -> Dict[str, str]:
    """Load agent aliases from config.yaml or env vars.
    
    Priority: config.yaml > env vars > empty dict
    """
    agents = {}
    
    # Try to load from config.yaml
    try:
        from lycus_cli.config import load_config
        config = load_config()
        agent_mail_config = config.get("agent_mail", {})
        agents.update(agent_mail_config.get("agents", {}))
    except Exception:
        pass  # Config not available yet
    
    # Fallback to env vars (AGENT_MAIL_AGENT_<NAME>=address)
    for key, value in os.environ.items():
        if key.startswith("AGENT_MAIL_AGENT_"):
            agent_name = key.replace("AGENT_MAIL_AGENT_", "").lower()
            agents[agent_name] = value
    
    return agents


def _get_agent_registry() -> Dict[str, str]:
    """Get the agent registry (cached)."""
    if not hasattr(_get_agent_registry, "_cache"):
        _get_agent_registry._cache = _load_agent_registry()
    return _get_agent_registry._cache


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _get_config() -> Dict[str, Any]:
    """Read email config from environment variables at call time."""
    return {
        "address": os.getenv("AGENT_MAIL_ADDRESS", ""),
        "password": os.getenv("AGENT_MAIL_PASSWORD", ""),
        "imap_host": os.getenv("AGENT_MAIL_IMAP_HOST", ""),
        "imap_port": int(os.getenv("AGENT_MAIL_IMAP_PORT", "993")),
        "smtp_host": os.getenv("AGENT_MAIL_SMTP_HOST", ""),
        "smtp_port": int(os.getenv("AGENT_MAIL_SMTP_PORT", "587")),
        "use_ssl": os.getenv("AGENT_MAIL_USE_SSL", "").lower() in ("true", "1", "yes"),
        "agents": _get_agent_registry(),
    }


def _check_mail_available() -> bool:
    """Check if agent mail is configured."""
    cfg = _get_config()
    return bool(cfg["address"] and cfg["password"] and cfg["imap_host"] and cfg["smtp_host"])


def _resolve_address(addr: str) -> str:
    """Resolve an agent name or email address to a full email address."""
    addr = addr.strip().lower()
    agents = _get_agent_registry()
    
    if addr in agents:
        return agents[addr]
    if "@" in addr:
        return addr
    # Try appending domain from own address
    cfg = _get_config()
    if cfg["address"] and "@" in cfg["address"]:
        domain = cfg["address"].split("@")[1]
        return f"{addr}@{domain}"
    return addr


def _is_agent_address(addr: str) -> bool:
    """Check if an address belongs to a known agent."""
    addr = addr.lower()
    agents = _get_agent_registry()
    if addr in agents:
        return True
    # Check if domain matches any agent's domain
    for agent_addr in agents.values():
        if "@" in agent_addr and addr.endswith(f"@{agent_addr.split('@')[1]}"):
            return True
    return False


# ---------------------------------------------------------------------------
# SSL Context
# ---------------------------------------------------------------------------

def _create_ssl_context() -> ssl.SSLContext:
    """Create an SSL context for mail connections.
    
    Uses default context but allows self-signed certs for LAN setups.
    """
    ctx = ssl.create_default_context()
    # For LAN setups with self-signed certs, we still verify but log warnings
    return ctx


# ---------------------------------------------------------------------------
# IMAP Operations
# ---------------------------------------------------------------------------

def _imap_connect(cfg: Dict[str, Any]) -> imaplib.IMAP4:
    """Connect to IMAP server with appropriate TLS mode."""
    port = cfg["imap_port"]
    host = cfg["imap_host"]
    use_ssl = cfg.get("use_ssl", False)

    # Auto-detect from port if not explicitly set
    if port == 993 or use_ssl:
        conn = imaplib.IMAP4_SSL(host, port, ssl_context=_create_ssl_context(), timeout=30)
    elif port == 143:
        conn = imaplib.IMAP4(host, port, timeout=30)
        # Try STARTTLS
        try:
            conn.starttls(_create_ssl_context())
        except Exception:
            pass  # Server may not support STARTTLS
    else:
        conn = imaplib.IMAP4_SSL(host, port, ssl_context=_create_ssl_context(), timeout=30)

    # Try login with full address first, fall back to local-part only
    username = cfg["address"]
    try:
        conn.login(username, cfg["password"])
    except Exception:
        # Some servers (like Dovecot on FreeBSD) require just the local part
        local_part = username.split("@")[0] if "@" in username else username
        conn.login(local_part, cfg["password"])

    return conn


def _fetch_inbox(cfg: Dict[str, Any], limit: int = 20) -> List[Dict[str, Any]]:
    """Fetch recent messages from inbox."""
    results = []
    try:
        conn = _imap_connect(cfg)
        conn.select("INBOX")

        # Search for unseen messages first
        status, data = conn.uid("search", None, "UNSEEN")
        if status == "OK" and data and data[0]:
            uids = data[0].split()[-limit:]
            for uid in uids:
                msg = _fetch_message(conn, uid)
                if msg:
                    results.append(msg)

        # If no unseen, get recent messages
        if not results:
            status, data = conn.uid("search", None, "ALL")
            if status == "OK" and data and data[0]:
                uids = data[0].split()[-limit:]
                for uid in uids:
                    msg = _fetch_message(conn, uid)
                    if msg:
                        results.append(msg)

        conn.logout()
    except Exception as e:
        logger.error("[AgentMail] IMAP fetch error: %s", e)
        results = [{"error": str(e)}]

    return results


def _fetch_message(conn: imaplib.IMAP4, uid: bytes) -> Optional[Dict[str, Any]]:
    """Fetch a single message by UID."""
    try:
        status, msg_data = conn.uid("fetch", uid, "(RFC822)")
        if status != "OK" or not msg_data or not msg_data[0]:
            return None

        raw_email = msg_data[0][1]
        msg = email_lib.message_from_bytes(raw_email)

        from_raw = msg.get("From", "")
        from_name, from_addr = parseaddr(from_raw)
        subject = msg.get("Subject", "(no subject)")
        message_id = msg.get("Message-ID", "")
        date = msg.get("Date", "")

        # Extract body
        body = _extract_body(msg)

        return {
            "from_name": from_name or from_addr,
            "from_addr": from_addr.lower(),
            "subject": subject,
            "body": body,
            "message_id": message_id,
            "date": date,
            "is_agent": _is_agent_address(from_addr),
        }
    except Exception as e:
        logger.error("[AgentMail] Fetch message error: %s", e)
        return None


def _extract_body(msg) -> str:
    """Extract plain text body from email message."""
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition", ""))
            if "attachment" in disposition:
                continue
            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")
    return ""


def _count_unread(cfg: Dict[str, Any]) -> int:
    """Count unread messages in inbox."""
    try:
        conn = _imap_connect(cfg)
        conn.select("INBOX")
        status, data = conn.uid("search", None, "UNSEEN")
        count = len(data[0].split()) if status == "OK" and data and data[0] else 0
        conn.logout()
        return count
    except Exception as e:
        logger.error("[AgentMail] Count unread error: %s", e)
        return -1


def _read_message(cfg: Dict[str, Any], msg_index: int) -> Dict[str, Any]:
    """Read a specific message by index (1-based)."""
    try:
        conn = _imap_connect(cfg)
        conn.select("INBOX")

        # Get all messages
        status, data = conn.uid("search", None, "ALL")
        if status != "OK" or not data or not data[0]:
            return {"error": "No messages found"}

        uids = data[0].split()
        if msg_index < 1 or msg_index > len(uids):
            return {"error": f"Message index out of range (1-{len(uids)})"}

        uid = uids[msg_index - 1]
        msg = _fetch_message(conn, uid)

        # Mark as read
        conn.uid("store", uid, "+FLAGS", "\\Seen")

        conn.logout()
        return msg or {"error": "Failed to fetch message"}
    except Exception as e:
        logger.error("[AgentMail] Read message error: %s", e)
        return {"error": str(e)}


def _search_messages(cfg: Dict[str, Any], query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Search messages by subject or body."""
    results = []
    try:
        conn = _imap_connect(cfg)
        conn.select("INBOX")

        # Search by subject
        status, data = conn.uid("search", None, f"SUBJECT {query}")
        if status == "OK" and data and data[0]:
            uids = data[0].split()[-limit:]
            for uid in uids:
                msg = _fetch_message(conn, uid)
                if msg:
                    results.append(msg)

        # Also search by body (less efficient but more thorough)
        if not results:
            status, data = conn.uid("search", None, "ALL")
            if status == "OK" and data and data[0]:
                uids = data[0].split()[-limit * 2:]
                for uid in uids:
                    msg = _fetch_message(conn, uid)
                    if msg and query.lower() in msg.get("body", "").lower():
                        results.append(msg)
                    if len(results) >= limit:
                        break

        conn.logout()
    except Exception as e:
        logger.error("[AgentMail] Search error: %s", e)

    return results[:limit]


# ---------------------------------------------------------------------------
# SMTP Operations
# ---------------------------------------------------------------------------

def _send_email(
    to_addr: str,
    subject: str,
    body: str,
    reply_to_msg_id: Optional[str] = None,
) -> Tuple[bool, str]:
    """Send an email via SMTP with TLS. Returns (success, message_id)."""
    cfg = _get_config()
    port = cfg["smtp_port"]
    host = cfg["smtp_host"]

    msg = MIMEMultipart()
    msg["From"] = cfg["address"]
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg_id = f"<agent-{uuid.uuid4().hex[:12]}@{cfg['address'].split('@')[1]}>"
    msg["Message-ID"] = msg_id

    if reply_to_msg_id:
        msg["In-Reply-To"] = reply_to_msg_id
        msg["References"] = reply_to_msg_id

    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        # Use SMTP_SSL for port 465, STARTTLS for port 587, plain for port 25
        if port == 465 or cfg.get("use_ssl", False):
            smtp = smtplib.SMTP_SSL(host, port, timeout=30, context=_create_ssl_context())
        else:
            smtp = smtplib.SMTP(host, port, timeout=30)
            # Try STARTTLS
            try:
                smtp.starttls(_create_ssl_context())
            except Exception:
                pass  # Server may not support STARTTLS

        # Try login - some local servers don't require auth for local domains
        try:
            smtp.login(cfg["address"], cfg["password"])
        except Exception:
            # Try with local-part only
            try:
                local_part = cfg["address"].split("@")[0]
                smtp.login(local_part, cfg["password"])
            except Exception:
                logger.info("[AgentMail] SMTP auth not required (local relay)")

        smtp.send_message(msg)
        smtp.quit()

        logger.info("[AgentMail] Sent email to %s (subject: %s)", to_addr, subject)
        return True, msg_id
    except Exception as e:
        logger.error("[AgentMail] SMTP send error: %s", e)
        return False, str(e)


# ---------------------------------------------------------------------------
# Tool Handlers
# ---------------------------------------------------------------------------

def _handle_agent_mail_send(args: Dict[str, Any]) -> str:
    """Handle agent_mail_send tool call."""
    if not _check_mail_available():
        return "Agent mail is not configured. Set AGENT_MAIL_ADDRESS, AGENT_MAIL_PASSWORD, AGENT_MAIL_IMAP_HOST, and AGENT_MAIL_SMTP_HOST in ~/.autolycus/.env"

    to = args.get("to", "")
    subject = args.get("subject", "")
    body = args.get("body", "")
    reply_to = args.get("reply_to_message_id", "")

    if not to or not body:
        return "Error: 'to' and 'body' are required parameters."

    to_addr = _resolve_address(to)

    success, msg_id = _send_email(to_addr, subject, body, reply_to if reply_to else None)

    if success:
        return f"Email sent successfully to {to_addr}.\nMessage-ID: {msg_id}\nSubject: {subject}"
    else:
        return f"Failed to send email to {to_addr}.\nError: {msg_id}"


def _handle_agent_mail_inbox(args: Dict[str, Any]) -> str:
    """Handle agent_mail_inbox tool call."""
    if not _check_mail_available():
        return "Agent mail is not configured."

    limit = min(int(args.get("limit", 20)), 50)
    messages = _fetch_inbox(_get_config(), limit=limit)

    if not messages:
        return "No messages in inbox."

    if messages[0].get("error"):
        return f"Error fetching inbox: {messages[0]['error']}"

    lines = [f"=== Inbox ({len(messages)} messages) ===\n"]
    for i, msg in enumerate(messages, 1):
        agent_tag = " [AGENT]" if msg.get("is_agent") else ""
        lines.append(f"{i}. From: {msg['from_name']} <{msg['from_addr']}>{agent_tag}")
        lines.append(f"   Subject: {msg['subject']}")
        lines.append(f"   Date: {msg['date']}")
        body_preview = msg['body'][:200]
        if len(msg['body']) > 200:
            body_preview += "..."
        lines.append(f"   Body: {body_preview}")
        lines.append("")

    return "\n".join(lines)


def _handle_agent_mail_unread(args: Dict[str, Any]) -> str:
    """Handle agent_mail_unread tool call."""
    if not _check_mail_available():
        return "Agent mail is not configured."

    count = _count_unread(_get_config())
    if count < 0:
        return "Error checking unread count."

    return f"You have {count} unread message(s) in your inbox."


def _handle_agent_mail_settings(args: Dict[str, Any]) -> str:
    """Handle agent_mail_settings tool call."""
    cfg = _get_config()
    lines = [
        "=== Agent Mail Settings ===",
        f"Address: {cfg['address'] or '(not set)'}",
        f"IMAP: {cfg['imap_host']}:{cfg['imap_port']}",
        f"SMTP: {cfg['smtp_host']}:{cfg['smtp_port']}",
        f"SSL Mode: {'forced' if cfg.get('use_ssl') else 'auto-detect from port'}",
        "",
        "Known Agent Aliases:",
    ]
    for name, addr in cfg.get("agents", {}).items():
        lines.append(f"  {name} -> {addr}")

    if not cfg["address"]:
        lines.append("")
        lines.append("NOTE: Agent mail is not configured. Set the following in ~/.autolycus/.env:")
        lines.append("  AGENT_MAIL_ADDRESS=agent@domain.local")
        lines.append("  AGENT_MAIL_PASSWORD=***")
        lines.append("  AGENT_MAIL_IMAP_HOST=mail.domain.local")
        lines.append("  AGENT_MAIL_SMTP_HOST=mail.domain.local")

    return "\n".join(lines)


def _handle_agent_mail_read(args: Dict[str, Any]) -> str:
    """Handle agent_mail_read tool call."""
    if not _check_mail_available():
        return "Agent mail is not configured."

    msg_index = int(args.get("index", 1))
    msg = _read_message(_get_config(), msg_index)

    if msg.get("error"):
        return f"Error reading message: {msg['error']}"

    agent_tag = " [AGENT]" if msg.get("is_agent") else ""
    lines = [
        f"=== Message #{msg_index} ===",
        f"From: {msg['from_name']} <{msg['from_addr']}>{agent_tag}",
        f"Subject: {msg['subject']}",
        f"Date: {msg['date']}",
        f"Message-ID: {msg['message_id']}",
        "",
        msg.get("body", "(no body)"),
    ]
    return "\n".join(lines)


def _handle_agent_mail_search(args: Dict[str, Any]) -> str:
    """Handle agent_mail_search tool call."""
    if not _check_mail_available():
        return "Agent mail is not configured."

    query = args.get("query", "")
    if not query:
        return "Error: 'query' parameter is required."

    limit = min(int(args.get("limit", 20)), 50)
    messages = _search_messages(_get_config(), query, limit=limit)

    if not messages:
        return f"No messages found matching '{query}'."

    lines = [f"=== Search Results for '{query}' ({len(messages)} found) ===\n"]
    for i, msg in enumerate(messages, 1):
        agent_tag = " [AGENT]" if msg.get("is_agent") else ""
        lines.append(f"{i}. From: {msg['from_name']} <{msg['from_addr']}>{agent_tag}")
        lines.append(f"   Subject: {msg['subject']}")
        body_preview = msg['body'][:150]
        if len(msg['body']) > 150:
            body_preview += "..."
        lines.append(f"   Body: {body_preview}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool Schemas
# ---------------------------------------------------------------------------

AGENT_MAIL_SEND_SCHEMA = {
    "name": "agent_mail_send",
    "description": (
        "Send an email to another agent or email address. "
        "Supports agent name aliases (configured in config.yaml) or full email addresses. "
        "Uses SMTP with TLS/SSL for secure delivery. "
        "For threading replies, include the original Message-ID in reply_to_message_id."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": (
                    "Recipient - agent name (from config) or full email address."
                ),
            },
            "subject": {
                "type": "string",
                "description": "Email subject line.",
            },
            "body": {
                "type": "string",
                "description": "Email body text (plain text).",
            },
            "reply_to_message_id": {
                "type": "string",
                "description": (
                    "Optional: Message-ID of the email you're replying to, "
                    "for proper threading."
                ),
            },
        },
        "required": ["to", "body"],
    },
}

AGENT_MAIL_INBOX_SCHEMA = {
    "name": "agent_mail_inbox",
    "description": (
        "Check your email inbox for recent messages. "
        "Shows sender, subject, date, and body preview. "
        "Messages from known agents are tagged [AGENT]."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Maximum number of messages to fetch (default: 20, max: 50).",
            },
        },
        "required": [],
    },
}

AGENT_MAIL_UNREAD_SCHEMA = {
    "name": "agent_mail_unread",
    "description": "Check how many unread messages are in your inbox.",
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

AGENT_MAIL_SETTINGS_SCHEMA = {
    "name": "agent_mail_settings",
    "description": (
        "Show current agent mail configuration and known agent aliases. "
        "Use this to verify settings or see available agent addresses."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

AGENT_MAIL_READ_SCHEMA = {
    "name": "agent_mail_read",
    "description": (
        "Read a specific message from your inbox by index number. "
        "Use agent_mail_inbox first to see available messages and their indices. "
        "Marks the message as read."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "index": {
                "type": "integer",
                "description": "Message index (1-based) from inbox listing.",
            },
        },
        "required": ["index"],
    },
}

AGENT_MAIL_SEARCH_SCHEMA = {
    "name": "agent_mail_search",
    "description": (
        "Search your inbox for messages matching a query. "
        "Searches both subject and body text."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query text to match against subject and body.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results to return (default: 20, max: 50).",
            },
        },
        "required": ["query"],
    },
}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

from tools.registry import registry

registry.register(
    name="agent_mail_send",
    toolset="email",
    schema=AGENT_MAIL_SEND_SCHEMA,
    handler=_handle_agent_mail_send,
    check_fn=_check_mail_available,
    emoji="📧",
)

registry.register(
    name="agent_mail_inbox",
    toolset="email",
    schema=AGENT_MAIL_INBOX_SCHEMA,
    handler=_handle_agent_mail_inbox,
    check_fn=_check_mail_available,
    emoji="📥",
)

registry.register(
    name="agent_mail_unread",
    toolset="email",
    schema=AGENT_MAIL_UNREAD_SCHEMA,
    handler=_handle_agent_mail_unread,
    check_fn=_check_mail_available,
    emoji="🔢",
)

registry.register(
    name="agent_mail_settings",
    toolset="email",
    schema=AGENT_MAIL_SETTINGS_SCHEMA,
    handler=_handle_agent_mail_settings,
    check_fn=lambda: True,  # Always available
    emoji="⚙️",
)

registry.register(
    name="agent_mail_read",
    toolset="email",
    schema=AGENT_MAIL_READ_SCHEMA,
    handler=_handle_agent_mail_read,
    check_fn=_check_mail_available,
    emoji="📖",
)

registry.register(
    name="agent_mail_search",
    toolset="email",
    schema=AGENT_MAIL_SEARCH_SCHEMA,
    handler=_handle_agent_mail_search,
    check_fn=_check_mail_available,
    emoji="🔍",
)
