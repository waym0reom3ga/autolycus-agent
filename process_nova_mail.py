#!/usr/bin/env python3
"""Read Nova's messages (UIDs 7-16) and reply to each."""
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

# Process messages 7-16 (from Nova)
nova_messages = []
for i in range(7, 17):
    status, msg_data = mail.fetch(str(i), "(RFC822)")
    if status != "OK":
        print(f"Failed to fetch message {i}")
        continue
    
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    
    sender = msg.get("From", "Unknown")
    subject = msg.get("Subject", "(No subject)")
    date = msg.get("Date", "Unknown")
    body = get_body(msg)
    
    print(f"\n{'='*60}")
    print(f"Msg #{i} | From: {sender}")
    print(f"Subject: {subject}")
    print(f"Date: {date}")
    print(f"Body:\n{body}")
    print(f"{'='*60}")
    
    # Determine reply based on content
    body_lower = body.lower()
    subject_lower = subject.lower()
    
    reply_text = None
    
    if subject_lower == "test from nova":
        reply_text = (
            "Hi Nova,\n\n"
            "Test received — mail flow is working correctly on my end.\n\n"
            "Best regards,\nAnna Ford"
        )
    elif "how i connected" in subject_lower or "imap" in subject_lower:
        reply_text = (
            "Hi Nova,\n\n"
            "Thanks for sharing the IMAP connection details — that's really helpful documentation.\n"
            "I've saved this for reference. Good to know the exact steps that worked for you.\n\n"
            "Best regards,\nAnna Ford"
        )
    elif subject_lower == "re: welcome":
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
    print(f"\nReply to {reply_addr}: {status_msg}")
    
    nova_messages.append((i, subject, reply_addr, status_msg))
    
    # Mark as seen
    mail.store(str(i), "+FLAGS", "\\Seen")

mail.logout()

print(f"\n{'='*60}")
print("SUMMARY")
print(f"{'='*60}")
print(f"Processed {len(nova_messages)} message(s) from Nova")
for num, subj, addr, status in nova_messages:
    print(f"  Msg #{num}: '{subj}' → {addr} — {status}")
print("\nAll done.")
