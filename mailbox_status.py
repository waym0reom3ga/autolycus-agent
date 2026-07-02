#!/usr/bin/env python3
"""Full mailbox status check."""
import imaplib
import email

IMAP_HOST = "192.168.86.218"
IMAP_PORT = 143
USERNAME = "anna.ford"
PASSWORD = "Talus2026!"

mail = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
mail.login(USERNAME, PASSWORD)
status, data = mail.select("INBOX", readonly=True)
total = int(data[0].decode())
print(f"Total messages in INBOX: {total}\n")

for i in range(1, total + 1):
    status, msg_data = mail.fetch(str(i), "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] FLAGS)")
    if status != "OK":
        print(f"  Msg #{i}: fetch failed")
        continue
    
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    
    # Get flags from second response
    flags = ""
    if len(msg_data) > 1:
        flags_raw = msg_data[1][0]
        if isinstance(flags_raw, bytes):
            flags = flags_raw.decode()
        else:
            flags = str(flags_raw)
    
    sender = msg.get("From", "Unknown")
    subject = msg.get("Subject", "(No subject)")
    date = msg.get("Date", "Unknown")
    seen = "\\Seen" in flags
    
    status_icon = "📖" if seen else "📩"
    print(f"{status_icon} Msg #{i:3d} | {sender}")
    print(f"       Subject: {subject}")
    print(f"       Date: {date}")
    print(f"       Flags: {flags}")
    print()

mail.logout()
print("Done.")
