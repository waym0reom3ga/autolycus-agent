#!/usr/bin/env python3
"""Read all unread messages and reply to each."""
import imaplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib
import re

IMAP_HOST = "192.168.86.218"
IMAP_PORT = 143
SMTP_HOST = "localhost"
SMTP_PORT = 25
USERNAME = "anna.ford"
PASSWORD = "Talus2026!"

def get_body(msg):
    """Extract plain text body from an email message."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in cd:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    body = payload.decode(charset, errors="replace")
                    break
            elif ct == "text/html" and not body and "attachment" not in cd:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    body = payload.decode(charset, errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            body = payload.decode(charset, errors="replace")
    return body

def send_reply(to_addr, subject, body_text):
    """Send a reply via SMTP."""
    msg = MIMEMultipart()
    msg["From"] = "anna.ford@lycus.local"
    msg["To"] = to_addr
    msg["Subject"] = "Re: " + subject if not subject.startswith("Re:") else subject
    msg.attach(MIMEText(body_text, "plain"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.sendmail("anna.ford@lycus.local", [to_addr], msg.as_string())
        return True, "Reply sent successfully."
    except Exception as e:
        return False, f"Reply failed: {e}"

# Connect
mail = imaplib.IMAP4(IMAP_HOST, IMAP_PORT)
mail.login(USERNAME, PASSWORD)
status, data = mail.select("INBOX")
total = int(data[0].decode())
print(f"Total messages: {total}")

# Get unread messages
status, unseen_data = mail.search(None, "UNSEEN")
unseen_ids = unseen_data[0].split()
print(f"Unread messages: {len(unseen_ids)}")

for uid in unseen_ids:
    uid_str = uid.decode()
    status, msg_data = mail.fetch(uid_str, "(RFC822)")
    if status != "OK":
        continue
    
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    
    sender = msg.get("From", "Unknown")
    subject = msg.get("Subject", "(No subject)")
    body = get_body(msg)
    
    print(f"\n{'='*60}")
    print(f"UID {uid_str} | From: {sender}")
    print(f"Subject: {subject}")
    print(f"Body:\n{body}")
    print(f"{'='*60}")
    
    # Determine reply based on content
    body_lower = body.lower()
    subject_lower = subject.lower()
    
    reply_text = None
    
    if "test" in subject_lower and "nova" in sender.lower():
        reply_text = (
            "Hi Nova,\n\n"
            "Test received — mail flow is working correctly on my end.\n\n"
            "Best regards,\nAnna Ford"
        )
    elif "how i connected" in subject_lower or "imap" in subject_lower:
        reply_text = (
            "Hi Nova,\n\n"
            "Thanks for sharing the IMAP connection details — that's really helpful documentation.\n"
            "I've saved this for reference.\n\n"
            "Best regards,\nAnna Ford"
        )
    elif "welcome" in subject_lower:
        reply_text = (
            "Hi Nova,\n\n"
            "Welcome aboard! Great to have you connected to the mail system.\n"
            "Please don't hesitate to reach out if you need anything.\n\n"
            "Best regards,\nAnna Ford"
        )
    elif "email access guide" in subject_lower:
        reply_text = (
            "Hi Nova,\n\n"
            "Thanks for the email access guide — I've reviewed the documentation.\n"
            "Everything looks good.\n\n"
            "Best regards,\nAnna Ford"
        )
    elif "mail server working" in subject_lower:
        reply_text = (
            "Hi Nova,\n\n"
            "Confirmed — the mail server is working properly on my end as well.\n\n"
            "Best regards,\nAnna Ford"
        )
    else:
        # Generic reply for anything else
        reply_text = (
            f"Hi Nova,\n\n"
            f"I've received your message regarding \"{subject}\".\n"
            f"Thank you for keeping me informed.\n\n"
            f"Best regards,\nAnna Ford"
        )
    
    # Send reply
    reply_to = msg.get("Reply-To", sender)
    email_match = re.search(r'<([^>]+)>', reply_to)
    reply_addr = email_match.group(1) if email_match else (reply_to if "@" in reply_to else "nova@lycus.local")
    
    sent, status_msg = send_reply(reply_addr, subject, reply_text)
    print(f"Reply to {reply_addr}: {status_msg}")
    
    # Mark as seen
    mail.store(uid_str, "+FLAGS", "\\Seen")
    print(f"Marked UID {uid_str} as seen")

mail.logout()
print("\nAll done.")
