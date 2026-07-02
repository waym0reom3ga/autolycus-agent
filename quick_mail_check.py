#!/usr/bin/env python3
"""Quick check: list all messages with dates and flags."""
import imaplib
import email
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

IMAP_SERVER = "192.168.86.218"
IMAP_PORT = 143
USERNAME = "anna.ford"
PASSWORD = "Talus2026!"

mail = imaplib.IMAP4(IMAP_SERVER, IMAP_PORT)
mail.login(USERNAME, PASSWORD)
status, data = mail.select("INBOX", readonly=True)

# Get all UIDs
status, data = mail.search(None, "ALL")
all_ids = data[0].split()
print(f"Total messages: {len(all_ids)}")
print(f"{'='*80}")

for uid in all_ids:
    uid_str = uid.decode()
    status, msg_data = mail.fetch(uid_str, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] FLAGS)")
    if status != "OK":
        continue
    
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    
    subject = msg.get("Subject", "(No Subject)")
    from_addr = msg.get("From", "Unknown")
    date_str = msg.get("Date", "")
    
    msg_date = None
    try:
        msg_date = parsedate_to_datetime(date_str)
        if msg_date.tzinfo is None:
            msg_date = msg_date.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        age = now - msg_date
        age_str = f"{age.days}d {age.seconds//3600}h" if age.days > 0 else f"{age.seconds//3600}h {age.seconds%3600//60}m"
    except Exception:
        age_str = "unknown"
    
    flags = msg_data[0][0].decode() if msg_data[0][0] else ""
    is_unseen = "\\Seen" not in flags
    
    marker = " << NEW" if is_unseen else ""
    print(f"UID {uid_str:>5} | {age_str:>8} | {'UNREAD' if is_unseen else 'READ':>6} | {from_addr[:40]:<40} | {subject[:50]}{marker}")

print(f"{'='*80}")
mail.logout()
