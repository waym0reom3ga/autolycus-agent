#!/usr/bin/env python3
"""Check all email on IMAP server, not just unseen."""
import imaplib
import email
from email.header import decode_header

def decode_mime(s):
    if s is None:
        return ""
    parts = decode_header(s)
    result = []
    for part, charset in parts:
        if isinstance(part, bytes):
            result.append(part.decode(charset or 'utf-8', errors='replace'))
        else:
            result.append(part)
    return "".join(result)

def get_body(msg):
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset()
                if payload:
                    body = payload.decode(charset or 'utf-8', errors='replace')
                    break
    else:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset()
        if payload:
            body = payload.decode(charset or 'utf-8', errors='replace')
    return body

try:
    mail = imaplib.IMAP4("192.168.86.218", 143)
    mail.login("anna.ford", "Talus2026!")

    # List all mailboxes
    status, mailboxes = mail.list()
    print("Mailboxes:")
    for mb in mailboxes:
        print(f"  {mb.decode()}")

    mail.select("INBOX")

    # Get overview
    status, overview = mail.status("INBOX", "(MESSAGES UNSEEN RECENT)")
    print(f"\nINBOX status: {overview}")

    # Search ALL messages
    status, messages = mail.search(None, "ALL")
    msg_ids = messages[0].split() if messages[0] else []
    print(f"\nTotal messages: {len(msg_ids)}")

    # Also try RECENT
    status, recent = mail.search(None, "RECENT")
    recent_ids = recent[0].split() if recent[0] else []
    print(f"Recent messages: {len(recent_ids)}")

    # Also try UNSEEN
    status, unseen = mail.search(None, "UNSEEN")
    unseen_ids = unseen[0].split() if unseen[0] else []
    print(f"Unseen messages: {len(unseen_ids)}")

    # Read last 10 messages if any exist
    if msg_ids:
        print("\n--- Last 10 messages ---")
        for mid in msg_ids[-10:]:
            status, msg_data = mail.fetch(mid, "(BODY.PEEK[TEXT] FLAGS SUBJECT FROM DATE)")
            # Get headers
            status, hdr = mail.fetch(mid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
            for resp in hdr:
                if isinstance(resp, tuple):
                    hdr_msg = email.message_from_bytes(resp[1])
                    subj = decode_mime(hdr_msg["Subject"])
                    frm = decode_mime(hdr_msg["From"])
                    dt = hdr_msg["Date"]
                    flags = ""
                    print(f"\n  ID={mid.decode()} | From: {frm} | Subject: {subj} | Date: {dt}")

    mail.logout()
except Exception as exc:
    import traceback
    traceback.print_exc()
    print(f"ERROR: {exc}")
