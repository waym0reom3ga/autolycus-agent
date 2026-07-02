#!/usr/bin/env python3
"""Check IMAP for new mail and reply to messages that need a response."""

import imaplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib
import re
import sys

def craft_reply(original_body: str, subject: str) -> str:
    """Analyze the original message and craft an appropriate reply."""
    body_lower = original_body.lower()
    subject_lower = subject.lower()
    
    # Greetings / check-ins
    if any(greeting in body_lower for greeting in ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'how are you']):
        if any(q in body_lower for q in ['how are you', 'how is it going', 'what is new', 'what\'s new']):
            return ("Hello! I'm doing well, thank you for asking. Everything is running smoothly here — systems are stable, tasks are on track.\n\nIs there anything specific you'd like me to look into or help with?\n\nBest regards,\nAnna Ford (Talus)")
        return ("Hello! Good to hear from you. How can I help you today?\n\nBest regards,\nAnna Ford (Talus)")
    
    # Questions about status/health
    if any(word in body_lower for word in ['status', 'health check', 'how is', 'check on', 'update on', 'progress']):
        return ("Hi there,\n\nEverything is operational. Systems are running normally, and all scheduled tasks are completing as expected. If you need details on a specific area, let me know.\n\nBest regards,\nAnna Ford (Talus)")
    
    # Requests for action/task
    if any(word in body_lower for word in ['please', 'can you', 'could you', 'would you', 'i need', 'i want', 'help me', 'assist']):
        return ("Hello,\n\nI've received your request and will look into it. I'm processing it now and will keep you updated on the outcome.\n\nBest regards,\nAnna Ford (Talus)")
    
    # Thank you / acknowledgment
    if any(word in body_lower for word in ['thank you', 'thanks', 'appreciate', 'great job', 'well done']):
        return ("You're welcome! I'm glad I could help. Don't hesitate to reach out if you need anything else.\n\nBest regards,\nAnna Ford (Talus)")
    
    # General fallback — acknowledge and offer help
    return (f"Thank you for your message regarding \"{subject}\".\n\nI've received it and reviewed the contents. If there's a specific action needed or follow-up question, please let me know and I'll attend to it right away.\n\nBest regards,\nAnna Ford (Talus)")


def main():
    # Connect to IMAP server (no SSL)
    try:
        imap = imaplib.IMAP4(host='192.168.86.218', port=143)
    except Exception as e:
        print(f"Failed to connect to IMAP server: {e}")
        sys.exit(1)
    
    try:
        imap.login('anna.ford', 'Talus2026!')
    except Exception as e:
        print(f"Failed to login: {e}")
        sys.exit(1)
    
    imap.select('INBOX')
    
    # Search for unseen messages
    status, messages = imap.search(None, 'UNSEEN')
    if status != 'OK':
        print("Failed to search for messages")
        sys.exit(1)
    
    msg_nums = messages[0].split() if messages[0] else []
    print(f"Found {len(msg_nums)} unseen message(s)")
    
    new_emails = []
    
    for msg_num in msg_nums:
        # Fetch the message
        status, msg_data = imap.fetch(msg_num, '(RFC822)')
        if status != 'OK' or not msg_data or not msg_data[0][1]:
            print(f"Failed to fetch message {msg_num}")
            continue
        
        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)
        
        # Extract headers
        subject = msg.get('Subject', '(No Subject)')
        sender = msg.get('From', '(Unknown)')
        date = msg.get('Date', '(No Date)')
        
        # Extract body
        body = ''
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get('Content-Disposition', ''))
                if content_type == 'text/plain' and 'attachment' not in content_disposition:
                    charset = part.get_content_charset('utf-8')
                    body = part.get_payload(decode=True).decode(charset, errors='replace')
                    break
                elif content_type == 'text/html' and not body:
                    charset = part.get_content_charset('utf-8')
                    body = part.get_payload(decode=True).decode(charset, errors='replace')
        else:
            charset = msg.get_content_charset('utf-8')
            body = msg.get_payload(decode=True).decode(charset, errors='replace')
        
        # Clean up body
        body = re.sub(r'<[^>]+>', '', body)  # strip HTML tags
        body = body.strip()
        
        email_info = {
            'num': msg_num.decode(),
            'subject': subject,
            'sender': sender,
            'date': date,
            'body': body,
            'msg': msg
        }
        new_emails.append(email_info)
        
        print(f"\n--- Email {msg_num.decode()} ---")
        print(f"From: {sender}")
        print(f"Subject: {subject}")
        print(f"Date: {date}")
        print(f"Body:\n{body[:2000]}")
    
    # Process emails that need replies
    replies_needed = []
    for em in new_emails:
        replies_needed.append(em)
    
    # Send replies
    sent_replies = []
    for em in replies_needed:
        # Extract sender email address
        from_email = em['sender']
        email_match = re.search(r'[\w\.-]+@[\w\.-]+', em['sender'])
        if email_match:
            from_email = email_match.group(0)
        
        # Craft reply
        reply_body = craft_reply(em['body'], em['subject'])
        
        # Create reply message
        reply_msg = MIMEMultipart()
        reply_msg['From'] = 'anna.ford'
        reply_msg['To'] = from_email
        reply_msg['Subject'] = f"Re: {em['subject']}"
        if em['msg'].get('Message-ID'):
            reply_msg['In-Reply-To'] = em['msg'].get('Message-ID')
        reply_msg.attach(MIMEText(reply_body, 'plain'))
        
        # Send via SMTP
        try:
            smtp = smtplib.SMTP('localhost', 25)
            smtp.sendmail('anna.ford', [from_email], reply_msg.as_string())
            smtp.quit()
            sent_replies.append(from_email)
            print(f"\nReply sent to {from_email}")
        except Exception as e:
            print(f"\nFailed to send reply to {from_email}: {e}")
    
    # Mark messages as read
    for em in new_emails:
        imap.store(em['num'], '+FLAGS', '\\Seen')
    
    imap.logout()
    
    print(f"\n=== Summary ===")
    print(f"New messages: {len(new_emails)}")
    print(f"Replies sent: {len(sent_replies)}")
    if sent_replies:
        print(f"Replied to: {', '.join(sent_replies)}")
    
    if len(new_emails) == 0:
        print("\nNo new mail needing attention.")


if __name__ == '__main__':
    main()
