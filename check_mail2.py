#!/usr/bin/env python3
"""Check IMAP for new mail — detailed fetch and reply."""
import imaplib
import email
from email.mime.text import MIMEText
import smtplib
import re

IMAP_HOST = "192.168.86.218"
IMAP_PORT = 143
SMTP_HOST = "localhost"
SMTP_PORT = 25
USERNAME = "anna.ford"
PASSWORD = "Talus2026!"

imap = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
imap.login(USERNAME, PASSWORD)
imap.select("INBOX")

# Fetch ALL recent messages (last 10)
status, data = imap.search(None, "ALL")
if status != "OK":
    print("IMAP search failed")
else:
    msg_ids = data[0].split()
    print(f"Total messages in INBOX: {len(msg_ids)}")

    # Fetch the last few messages
    recent_count = min(len(msg_ids), 10)
    recent_ids = msg_ids[-recent_count:]

    for msg_id in recent_ids:
        status, msg_data = imap.fetch(msg_id, "(UID RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] FLAGS)")
        if status != "OK":
            continue

        raw_headers = msg_data[0][1]
        msg = email.message_from_bytes(raw_headers)

        uid = msg.get("Message-Id", "unknown")
        from_addr = msg.get("From", "unknown")
        subject = msg.get("Subject", "(No Subject)")
        date = msg.get("Date", "unknown")
        flags = msg_data[0][0].decode() if isinstance(msg_data[0][0], bytes) else str(msg_data[0][0])

        # Extract email address
        email_match = re.search(r'<([^>]+)>', from_addr)
        sender_email = email_match.group(1) if email_match else from_addr

        print(f"\n{'='*60}")
        print(f"From: {from_addr}")
        print(f"Sender email: {sender_email}")
        print(f"Subject: {subject}")
        print(f"Date: {date}")
        print(f"Flags: {flags}")

        # Check if already seen
        if "\\Seen" in flags:
            print("Status: Already read")
            continue

        # Fetch body
        status, body_data = imap.fetch(msg_id, "(BODY.PEEK[TEXT])")
        if status == "OK" and body_data[0][1]:
            body = body_data[0][1].decode(errors="replace")
            # Clean up MIME boundaries
            body = re.sub(r'--[^=]+==\s*\n.*?\n', '', body, flags=re.DOTALL)
            body = re.sub(r'Content-(Type|Transfer-Encoding|Disposition):.*?\n', '', body, flags=re.DOTALL)
            body = re.sub(r'MIME-Version:.*?\n', '', body, flags=re.DOTALL)
            body = body.strip()
            print(f"Body (first 800 chars):\n{body[:800]}")

        print(f"Status: UNREAD — needs attention")

imap.logout()
print("\nDone.")
