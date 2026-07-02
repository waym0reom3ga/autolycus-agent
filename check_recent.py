#!/usr/bin/env python3
"""Check recent messages for anything needing follow-up."""
import imaplib
import email
import re

imap = imaplib.IMAP4("localhost", 143)
imap.login("anna.ford", "Talus2026!")
imap.select("INBOX")

# Get the 10 most recent messages
status, data = imap.search(None, "ALL")
all_ids = data[0].split() if data[0] else []
recent_ids = all_ids[-10:] if len(all_ids) >= 10 else all_ids

print(f"Checking {len(recent_ids)} most recent messages...\n")

for msg_id in recent_ids:
    status, msg_data = imap.fetch(msg_id, "(RFC822)")
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    
    subject = msg.get("Subject", "(No Subject)")
    sender = msg.get("From", "Unknown")
    date_sent = msg.get("Date", "Unknown")
    
    # Get flags
    status, flag_data = imap.fetch(msg_id, "(FLAGS)")
    flags_raw = flag_data[0][1] if flag_data[0] else b""
    flags = flags_raw.decode() if isinstance(flags_raw, bytes) else str(flags_raw)
    
    # Get body
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                body = part.get_payload(decode=True).decode(errors="replace")
                break
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode(errors="replace")
    
    body_clean = re.sub(r'<[^>]+>', '', body).strip()
    
    print(f"--- ID {msg_id.decode()} [{flags}] ---")
    print(f"From: {sender}")
    print(f"Subject: {subject}")
    print(f"Date: {date_sent}")
    print(f"Body preview: {body_clean[:500]}")
    print()

# Check Sent folder for recent replies
try:
    imap.select("Sent")
    status, data = imap.search(None, "ALL")
    sent_ids = data[0].split() if data[0] else []
    print(f"Sent folder: {len(sent_ids)} messages")
    
    recent_sent = sent_ids[-5:] if len(sent_ids) >= 5 else sent_ids
    for msg_id in recent_sent:
        status, msg_data = imap.fetch(msg_id, "(BODY[HEADER.FIELDS (SUBJECT TO DATE FROM)])")
        raw = msg_data[0][1]
        msg = email.message_from_bytes(raw)
        print(f"  Sent: {msg.get('Subject', '?')} -> {msg.get('To', '?')} ({msg.get('Date', '?')})")
except Exception as e:
    print(f"Could not check Sent folder: {e}")

imap.close()
imap.logout()
