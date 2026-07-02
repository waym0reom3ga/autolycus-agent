#!/usr/bin/env python3
"""Read bodies of recent messages using UID fetch."""
import imaplib
import email
import re

IMAP_HOST = "192.168.86.218"
IMAP_PORT = 143
USERNAME = "anna.ford"
PASSWORD = "Talus2026!"

imap = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
imap.login(USERNAME, PASSWORD)
imap.select("INBOX")

# Use UID FETCH
for uid in [53, 54, 55]:
    status, data = imap.uid('FETCH', str(uid), "(BODY.PEEK[TEXT])")
    if status != "OK":
        print(f"UID {uid}: fetch failed")
        continue

    raw = data[0][1].decode(errors="replace")
    # Clean MIME
    cleaned = re.sub(r'--[^=]+==\s*\n.*?\n', '', raw, flags=re.DOTALL)
    cleaned = re.sub(r'Content-(Type|Transfer-Encoding|Disposition):.*?\n', '', cleaned, flags=re.DOTALL)
    cleaned = re.sub(r'MIME-Version:.*?\n', '', cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()

    print(f"\n{'='*60}")
    print(f"UID {uid}:")
    print(cleaned[:2000])
    print(f"{'='*60}")

imap.logout()
