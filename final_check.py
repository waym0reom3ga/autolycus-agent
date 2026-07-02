#!/usr/bin/env python3
"""Final check for any new unread messages."""
import imaplib

IMAP_HOST = "192.168.86.218"
IMAP_PORT = 143
USERNAME = "anna.ford"
PASSWORD = "Talus2026!"

imap = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
imap.login(USERNAME, PASSWORD)
imap.select("INBOX")

# Count unread
status, data = imap.search(None, "UNSEEN")
msg_ids = data[0].split() if data[0] else []

# Also get totals
status, data = imap.status("INBOX", "(MESSAGES UNSEEN)")
info = data[0].decode()

print(f"INBOX status: {info}")
print(f"Unread messages: {len(msg_ids)}")

if msg_ids:
    for mid in msg_ids:
        status, r = imap.fetch(mid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])")
        if status == "OK":
            print(f"  Unread: {r[0][1].decode(errors='replace')[:200]}")

imap.logout()
