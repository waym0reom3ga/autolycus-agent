#!/usr/bin/env python3
"""Check for any recent messages (last 24h) regardless of read status."""
import imaplib
import email
import re
from datetime import datetime, timedelta

imap = imaplib.IMAP4("192.168.86.218", 143)
imap.login("anna.ford", "Talus2026!")
imap.select("INBOX")

# Search for SINCE yesterday
cutoff = (datetime.now() - timedelta(days=1)).strftime("%d-%b-%Y")
status, messages = imap.search(None, f'(SINCE {cutoff})')
msg_ids = messages[0].split() if messages[0] else []

print(f"Found {len(msg_ids)} message(s) in last 24 hours")

recent = []
for msg_id in msg_ids[-10:]:  # Last 10 at most
    status, msg_data = imap.fetch(msg_id, "(RFC822 FLAGS)")
    if status != "OK":
        continue
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    
    subject = msg.get("Subject", "(No Subject)")
    sender = msg.get("From", "Unknown")
    flags = msg_data[0][0].decode() if msg_data[0][0] else ""
    is_unseen = "(\\Seen)" not in flags
    
    # Get body preview
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in cd:
                charset = part.get_content_charset() or "utf-8"
                try:
                    body = part.get_payload(decode=True).decode(charset, errors="replace")
                except:
                    body = str(part.get_payload(decode=True))
                break
    
    recent.append({"subject": subject, "from": sender, "unseen": is_unseen, "body": body[:500]})
    print(f"\n{'[UNREAD]' if is_unseen else '[READ]'} From: {sender}")
    print(f"    Subject: {subject}")
    print(f"    Flags: {flags}")
    print(f"    Preview: {body[:200]}")

imap.logout()

if not recent:
    print("\nNo recent messages at all.")
else:
    unseen_count = sum(1 for r in recent if r["unseen"])
    print(f"\nTotal recent: {len(recent)}, Unread: {unseen_count}")
