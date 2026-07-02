#!/usr/bin/env python3
"""Check recent emails (last 2 days) that might need a reply."""
import imaplib
import email
from email.header import decode_header
from datetime import datetime, timedelta

def decode_mime_header(header_value):
    if not header_value:
        return ""
    decoded_parts = decode_header(header_value)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            result.append(part.decode(charset or 'utf-8', errors='replace'))
        else:
            result.append(part)
    return " ".join(result)

def get_email_body(msg):
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in cd:
                charset = part.get_content_charset() or 'utf-8'
                try:
                    body = part.get_payload(decode=True).decode(charset, errors='replace')
                    break
                except Exception:
                    continue
    if not body:
        charset = msg.get_content_charset() or 'utf-8'
        try:
            body = msg.get_payload(decode=True).decode(charset, errors='replace')
        except Exception:
            body = str(msg.get_payload(decode=True))
    return body

mail = imaplib.IMAP4('192.168.86.218', 143)
mail.login('anna.ford', 'Talus2026!')
status, messages = mail.select('INBOX')
total = messages[0].decode()
print(f"Total messages in INBOX: {total}")

# Search for emails in the last 2 days
two_days_ago = (datetime.now() - timedelta(days=2)).strftime("%d-%b-%Y")
status, recent_data = mail.search(None, f'(SINCE {two_days_ago})')

if status == 'OK':
    recent_ids = recent_data[0].split()
    print(f"Messages in last 2 days: {len(recent_ids)}")
    
    for msg_id in recent_ids[-10:]:  # last 10 most recent
        msg_id_str = msg_id.decode()
        status, msg_data = mail.fetch(msg_id, '(RFC822 FLAGS)')
        if status != 'OK':
            continue
        
        raw = msg_data[0][1]
        msg = email.message_from_bytes(raw)
        
        subject = decode_mime_header(msg.get('Subject', ''))
        from_addr = decode_mime_header(msg.get('From', ''))
        date = msg.get('Date', '')
        
        # Check flags
        flags_line = msg_data[0][0].decode()
        is_read = '\\Seen' in flags_line
        is_flagged = '\\Flagged' in flags_line
        
        print(f"\n{'='*60}")
        print(f"ID: {msg_id_str} | {'READ' if is_read else 'NEW'} | {'FLAGGED' if is_flagged else ''}")
        print(f"From: {from_addr}")
        print(f"Subject: {subject}")
        print(f"Date: {date}")
        
        # Get body for flagged or unread
        if not is_read or is_flagged:
            status, body_data = mail.fetch(msg_id, '(RFC822)')
            if status == 'OK':
                raw = body_data[0][1]
                msg = email.message_from_bytes(raw)
                body = get_email_body(msg)
                print(f"Body:\n{body[:1500]}")
                if len(body) > 1500:
                    print(f"[... truncated]")
else:
    print("No recent messages found.")

mail.logout()
