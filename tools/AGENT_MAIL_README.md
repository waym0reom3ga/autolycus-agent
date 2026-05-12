# Agent Mail Tool

Agent-to-agent email communication using Python's standard library `imaplib` and `smtplib` with full TLS/SSL support.

## Overview

This toolset provides six LLM-callable tools for agent-to-agent email communication:

| Tool | Description |
|------|-------------|
| `agent_mail_send` | Send an email to another agent |
| `agent_mail_inbox` | Check inbox for recent messages |
| `agent_mail_read` | Read a specific message by index |
| `agent_mail_search` | Search inbox by subject/body |
| `agent_mail_unread` | Count unread messages |
| `agent_mail_settings` | Show current configuration |

## Configuration

### Environment Variables (Required)

Add to `~/.hermes/.env`:

```bash
AGENT_MAIL_ADDRESS=agent@domain.local
AGENT_MAIL_PASSWORD=your_password
AGENT_MAIL_IMAP_HOST=mail.domain.local
AGENT_MAIL_IMAP_PORT=993
AGENT_MAIL_SMTP_HOST=mail.domain.local
AGENT_MAIL_SMTP_PORT=587
```

### Agent Registry (Optional)

Configure agent aliases in `~/.hermes/config.yaml`:

```yaml
agent_mail:
  agents:
    agent_name: agent@domain.local
    another_agent: another@domain.local
```

Or via environment variables:

```bash
AGENT_MAIL_AGENT_agent_name=agent@domain.local
AGENT_MAIL_AGENT_another_agent=another@domain.local
```

## TLS/SSL Support

The tool auto-detects TLS mode from port numbers:

| Port | Protocol | TLS Mode |
|------|----------|----------|
| 993 | IMAP | Implicit SSL |
| 143 | IMAP | STARTTLS upgrade |
| 465 | SMTP | Implicit SSL |
| 587 | SMTP | STARTTLS upgrade |
| 25 | SMTP | Plain (with STARTTLS attempt) |

Set `AGENT_MAIL_USE_SSL=true` to force implicit SSL mode regardless of port.

## Testing Protocol

### Quick Test

```bash
cd ~/compiled/autolycus-agent/tools
python3 test_agent_mail.py
```

### Test with Custom Config

```bash
AGENT_MAIL_ADDRESS=test@domain.local \
AGENT_MAIL_PASSWORD=secret \
AGENT_MAIL_IMAP_HOST=mail.domain.local \
AGENT_MAIL_IMAP_PORT=993 \
AGENT_MAIL_SMTP_HOST=mail.domain.local \
AGENT_MAIL_SMTP_PORT=587 \
python3 test_agent_mail.py
```

### Test Output

```
Agent Mail Tool Test Suite

Config: test@domain.local @ mail.domain.local:993
SMTP: mail.domain.local:587
------------------------------------------------------------

Connection Tests:
  ✓ IMAP Connection (TLS) - TLS TLSv1.3
  ✓ SMTP Connection (TLS) - STARTTLS upgrade successful
  ✓ TLS Certificate - Certificate: mail.domain.local

Functional Tests:
  ✓ Tool Module Import - All 6 tools registered
  ✓ Send/Receive Loop - Test email delivered successfully

Test Summary: 5/5 passed
```

### CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Test Agent Mail
  run: |
    export AGENT_MAIL_ADDRESS=${{ secrets.AGENT_MAIL_ADDRESS }}
    export AGENT_MAIL_PASSWORD=${{ secrets.AGENT_MAIL_PASSWORD }}
    export AGENT_MAIL_IMAP_HOST=${{ secrets.AGENT_MAIL_IMAP_HOST }}
    export AGENT_MAIL_IMAP_PORT=${{ secrets.AGENT_MAIL_IMAP_PORT }}
    export AGENT_MAIL_SMTP_HOST=${{ secrets.AGENT_MAIL_SMTP_HOST }}
    export AGENT_MAIL_SMTP_PORT=${{ secrets.AGENT_MAIL_SMTP_PORT }}
    python3 tools/test_agent_mail.py
```

## Usage Examples

### Send Email

```python
agent_mail_send({
    "to": "agent_name",
    "subject": "Hello",
    "body": "Message text",
    "reply_to_message_id": "<optional-message-id>"
})
```

### Check Inbox

```python
agent_mail_inbox({"limit": 10})
```

### Read Message

```python
agent_mail_read({"index": 1})
```

### Search

```python
agent_mail_search({"query": "kanboard", "limit": 10})
```

## Troubleshooting

### Connection Refused

- Verify mail server is running and listening on the specified port
- Check firewall rules
- Test with `telnet mail.domain.local 993`

### Authentication Failed

- The tool tries both full email and local-part only login
- Check IMAP/SMTP authentication settings on the server
- Verify password is correct

### TLS Handshake Failed

- For self-signed certificates, the tool uses default SSL context
- If strict verification is needed, configure certificate paths
- Test with `openssl s_client -connect mail.domain.local:993`

## Security Notes

- Passwords should be stored in `.env` files, not in code
- TLS is used by default for all connections
- Agent registry is loaded from config, not hardcoded
- No credentials are logged or stored in plaintext
