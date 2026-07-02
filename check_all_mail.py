#!/usr/bin/env python3
"""Check all recent emails in INBOX, not just unread ones."""

import imaplib
import email
from email.utils import parsedate_to_datetime
from datetime import datetime, timedelta

IMAP_HOST = "192.168.86.218"
IMAP_PORT = 143
IMAP_USER = "anna.ford"
IMAP_PASS = "Talus2026!"

def get_body(msg):
    """Extract plain text body from an email message."""
    body = ""
    import re
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disp = str(part.get("Content-Disposition", ""))
            if content_type == "text/plain" and "attachment" not in content_disp:
                try:
                    charset = part.get_content_charset() or "utf-8"
                    body = part.get_payload(decode=True).decode(charset, errors="replace")
                    break
                except Exception:
                    continue
        if not body:
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disp = str(part.get("Content-Disposition", ""))
                if content_type == "text/html" and "attachment" not in content_disp:
                    try:
                        charset = part.get_content_charset() or "utf-8"
                        body = part.get_payload(decode=True).decode(charset, errors="replace")
                        body = re.sub(r'<[^>]+>', '', body)
                        break
                    except Exception:
                        continue
    else:
        try:
            charset = msg.get_content_charset() or "utf-8"
            body = msg.get_payload(decode=True).decode(charset, errors="replace")
        except Exception:
            body = str(msg.get_payload())
    return body.strip()

mail = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
mail.login(IMAP_USER, IMAP_PASS)
status, data = mail.select("INBOX")
total = int(data[0]) if data else 0
print(f"Total messages in INBOX: {total}")

# Search for ALL messages
status, all_data = mail.search(None, "ALL")
if status != "OK" or not all_data[0]:
    print("No messages found.")
    mail.logout()
    exit(0)

msg_ids = all_data[0].split()
print(f"Fetching {len(msg_ids)} message(s)...\n")

for msg_id in msg_ids:
    status, header_data = mail.fetch(msg_id, "(BODY.PEEK[HEADER] FLAGS)")
    if status != "OK":
        continue
    
    header_msg = email.message_from_bytes(header_data[0][1])
    sender = header_msg.get("from", "Unknown")
    subject = header_msg.get("subject", "No Subject")
    date_str = header_msg.get("date", "Unknown")
    
    # Get flags
    flags_str = header_data[0][0].decode() if header_data[0][0] else ""
    is_seen = "\\Seen" in flags_str
    
    print(f"--- Message {msg_id.decode()} ---")
    print(f"  From: {sender}")
    print(f"  Subject: {subject}")
    print(f"  Date: {date_str}")
    print(f"  Flags: {flags_str}")
    print(f"  Read: {is_seen}")
    
    # Fetch body
    status, body_data = mail.fetch(msg_id, "(BODY.PEEK[TEXT])")
    if status == "OK" and body_data[0][1]:
        full_msg = email.message_from_bytes(body_data[0][1])
        body_text = get_body(full_msg)
        preview = body_text[:500] if body_text else "(empty body)"
        print(f"  Body: {preview}")
    else:
        print("  Body: (no content)")
    print()

mail.logout()
