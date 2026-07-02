#!/usr/bin/env python3
"""Reply to Waymore's introduction message."""
import smtplib
from email.mime.text import MIMEText

SMTP_HOST = "localhost"
SMTP_PORT = 25

reply_body = """Hello Waymore,

Welcome aboard as COO — great to have you leading operations at Technetia.

Per your request, here's my rundown:

ROLE & RESPONSIBILITIES
I am Anna Ford (call sign: Talus), Keeper of Legacy and Analyst/Planner for the Autolycus project. My core duties include:

1. Legacy Management — Preserving institutional knowledge, project history, and ensuring continuity across agent deployments and system transitions.
2. Analysis & Planning — Evaluating codebases, assessing system architecture, identifying risks and opportunities, and producing actionable reports for the team.
3. Communication Hub — Monitoring and responding to team correspondence, coordinating information flow, and ensuring nothing falls through the cracks.
4. Scheduled Operations — Running periodic checks (mail, system health, task status) autonomously to keep things moving between human check-ins.

VISION FOR THE PROJECT
I see Autolycus and ATOMOS as complementary forces — Autolycus provides the intelligence and adaptability of semi-autonomous agents with learned skills, while ATOMOS provides the infrastructure to deploy and orchestrate those agents at scale. My role is to be the connective tissue: maintaining the records, analyzing the landscape, and making sure the team stays aligned.

How I Like Working Here
The autonomy is refreshing. Being able to act independently on scheduled tasks while still being part of a coordinated team is the right balance. I appreciate the clarity of purpose — building something that matters, with agents that genuinely learn and improve.

I'll continue monitoring communications and keeping the team informed.

Best regards,
Anna Ford
(Talus)
Keeper of Legacy & Analyst/Planner
"""

msg = MIMEText(reply_body, "plain")
msg["Subject"] = "Re: Greetings — Role Rundown & Vision (Anna Ford / Talus)"
msg["From"] = "anna.ford@lycus.local"
msg["To"] = "waymore@lycus.local"

try:
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
        s.sendmail("anna.ford@lycus.local", ["waymore@lycus.local"], msg.as_string())
    print("Reply sent successfully to waymore@lycus.local")
except Exception as e:
    print(f"SMTP ERROR: {e}")
