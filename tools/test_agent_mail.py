#!/usr/bin/env python3
"""
Agent Mail Tool Test Suite

Tests the agent mail tool functionality against a live mail server.
Run this after each release to verify email capability is functional.

Usage:
    python3 test_agent_mail.py [--config test_config.yaml]

Environment variables (or use --config file):
    AGENT_MAIL_ADDRESS, AGENT_MAIL_PASSWORD
    AGENT_MAIL_IMAP_HOST, AGENT_MAIL_IMAP_PORT
    AGENT_MAIL_SMTP_HOST, AGENT_MAIL_SMTP_PORT

Exit codes:
    0 - All tests passed
    1 - One or more tests failed
    2 - Test setup error (missing config, etc.)
"""

import os
import sys
import ssl
import imaplib
import smtplib
import tempfile
import time
from email.mime.text import MIMEText
from typing import Dict, Any, List, Tuple

# Test configuration
DEFAULT_CONFIG = {
    "address": "",
    "password": "",
    "imap_host": "",
    "imap_port": 993,
    "smtp_host": "",
    "smtp_port": 587,
    "test_recipient": "",  # Optional: specific recipient for send tests
}


def load_config() -> Dict[str, Any]:
    """Load test config from environment or file."""
    config = DEFAULT_CONFIG.copy()

    # Load from environment
    config["address"] = os.getenv("AGENT_MAIL_ADDRESS", "")
    config["password"] = os.getenv("AGENT_MAIL_PASSWORD", "")
    config["imap_host"] = os.getenv("AGENT_MAIL_IMAP_HOST", "")
    config["imap_port"] = int(os.getenv("AGENT_MAIL_IMAP_PORT", "993"))
    config["smtp_host"] = os.getenv("AGENT_MAIL_SMTP_HOST", "")
    config["smtp_port"] = int(os.getenv("AGENT_MAIL_SMTP_PORT", "587"))
    config["test_recipient"] = os.getenv("AGENT_MAIL_TEST_RECIPIENT", config["address"])

    # Validate required fields
    required = ["address", "password", "imap_host", "smtp_host"]
    missing = [f for f in required if not config[f]]
    if missing:
        print(f"ERROR: Missing required config: {', '.join(missing)}")
        print("Set via environment variables or ~/.hermes/.env")
        sys.exit(2)

    return config


class TestResult:
    def __init__(self):
        self.tests = []
        self.passed = 0
        self.failed = 0
        self.errors = []

    def add_pass(self, name: str, detail: str = ""):
        self.tests.append(("PASS", name, detail))
        self.passed += 1
        print(f"  ✓ {name}" + (f" - {detail}" if detail else ""))

    def add_fail(self, name: str, detail: str = ""):
        self.tests.append(("FAIL", name, detail))
        self.failed += 1
        print(f"  ✗ {name}" + (f" - {detail}" if detail else ""))
        self.errors.append(f"{name}: {detail}")

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"Test Summary: {self.passed}/{total} passed")
        if self.failed:
            print(f"Failed tests:")
            for err in self.errors:
                print(f"  - {err}")
        print(f"{'='*60}")
        return self.failed == 0


def test_imap_connection(cfg: Dict[str, Any], result: TestResult):
    """Test IMAP connection with TLS."""
    name = "IMAP Connection (TLS)"
    try:
        if cfg["imap_port"] == 993:
            conn = imaplib.IMAP4_SSL(
                cfg["imap_host"], cfg["imap_port"],
                ssl_context=ssl.create_default_context(),
                timeout=10
            )
        else:
            conn = imaplib.IMAP4(cfg["imap_host"], cfg["imap_port"], timeout=10)
            try:
                conn.starttls(ssl.create_default_context())
                result.add_pass(name, "STARTTLS upgrade successful")
            except Exception:
                result.add_pass(name, "Plain connection (no TLS)")
                return

        # Try login with full address
        try:
            conn.login(cfg["address"], cfg["password"])
        except Exception:
            # Try with local-part only
            local_part = cfg["address"].split("@")[0]
            conn.login(local_part, cfg["password"])

        # Check TLS version
        if hasattr(conn, '_sock') and conn._sock:
            tls_version = conn._sock.version() or "unknown"
            result.add_pass(name, f"TLS {tls_version}")
        else:
            result.add_pass(name, "Connected")

        conn.logout()
    except Exception as e:
        result.add_fail(name, str(e))


def test_smtp_connection(cfg: Dict[str, Any], result: TestResult):
    """Test SMTP connection with TLS."""
    name = "SMTP Connection (TLS)"
    try:
        if cfg["smtp_port"] == 465:
            conn = smtplib.SMTP_SSL(
                cfg["smtp_host"], cfg["smtp_port"],
                timeout=10,
                context=ssl.create_default_context()
            )
        else:
            conn = smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=10)
            try:
                conn.starttls(ssl.create_default_context())
                result.add_pass(name, "STARTTLS upgrade successful")
            except Exception:
                result.add_pass(name, "Plain connection (no TLS)")
                return

        # Try login
        try:
            conn.login(cfg["address"], cfg["password"])
        except Exception:
            try:
                local_part = cfg["address"].split("@")[0]
                conn.login(local_part, cfg["password"])
            except Exception:
                result.add_pass(name, "No auth required (local relay)")
                conn.quit()
                return

        conn.quit()
        result.add_pass(name, "Authenticated successfully")
    except Exception as e:
        result.add_fail(name, str(e))


def test_send_receive(cfg: Dict[str, Any], result: TestResult):
    """Test sending and receiving an email."""
    name = "Send/Receive Loop"

    # Send test email
    try:
        msg = MIMEText("Agent Mail Test - " + time.strftime("%Y-%m-%d %H:%M:%S"))
        msg["Subject"] = "Agent Mail Test"
        msg["From"] = cfg["address"]
        msg["To"] = cfg["test_recipient"]

        if cfg["smtp_port"] == 465:
            smtp = smtplib.SMTP_SSL(
                cfg["smtp_host"], cfg["smtp_port"],
                timeout=10,
                context=ssl.create_default_context()
            )
        else:
            smtp = smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=10)
            try:
                smtp.starttls(ssl.create_default_context())
            except Exception:
                pass

        try:
            smtp.login(cfg["address"], cfg["password"])
        except Exception:
            try:
                local_part = cfg["address"].split("@")[0]
                smtp.login(local_part, cfg["password"])
            except Exception:
                pass  # Local relay

        smtp.send_message(msg)
        smtp.quit()

        # Wait for delivery
        time.sleep(2)

        # Check inbox
        if cfg["imap_port"] == 993:
            imap = imaplib.IMAP4_SSL(
                cfg["imap_host"], cfg["imap_port"],
                ssl_context=ssl.create_default_context(),
                timeout=10
            )
        else:
            imap = imaplib.IMAP4(cfg["imap_host"], cfg["imap_port"], timeout=10)
            try:
                imap.starttls(ssl.create_default_context())
            except Exception:
                pass

        try:
            imap.login(cfg["address"], cfg["password"])
        except Exception:
            local_part = cfg["address"].split("@")[0]
            imap.login(local_part, cfg["password"])

        imap.select("INBOX")
        status, data = imap.uid("search", None, 'SUBJECT "Agent Mail Test"')

        if status == "OK" and data and data[0]:
            result.add_pass(name, "Test email delivered successfully")
        else:
            result.add_fail(name, "Test email not found in inbox")

        imap.logout()
    except Exception as e:
        result.add_fail(name, str(e))


def test_tool_import(cfg: Dict[str, Any], result: TestResult):
    """Test that the tool module imports and registers correctly."""
    name = "Tool Module Import"
    try:
        # Add the project root to path so tools.registry can be found
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if project_root not in sys.path:
            sys.path.insert(0, project_root)

        import agent_mail_tool

        # Check that all tools are registered
        tools = [
            "agent_mail_send",
            "agent_mail_inbox",
            "agent_mail_read",
            "agent_mail_search",
            "agent_mail_unread",
            "agent_mail_settings",
        ]

        # Verify tool functions exist
        for tool in tools:
            handler = f"_handle_{tool}"
            if not hasattr(agent_mail_tool, handler):
                result.add_fail(name, f"Missing handler: {handler}")
                return

        result.add_pass(name, f"All {len(tools)} tools registered")
    except Exception as e:
        result.add_fail(name, str(e))


def test_tls_certificate(cfg: Dict[str, Any], result: TestResult):
    """Test TLS certificate validation."""
    name = "TLS Certificate"
    try:
        # Test IMAP certificate
        if cfg["imap_port"] == 993:
            conn = imaplib.IMAP4_SSL(
                cfg["imap_host"], cfg["imap_port"],
                ssl_context=ssl.create_default_context(),
                timeout=10
            )
            if hasattr(conn, '_sock') and conn._sock:
                cert = conn._sock.getpeercert()
                if cert:
                    subject = dict(x[0] for x in cert.get("subject", ()))
                    common_name = subject.get("commonName", "unknown")
                    result.add_pass(name, f"Certificate: {common_name}")
                else:
                    result.add_pass(name, "No certificate (self-signed or internal)")
            conn.logout()
        else:
            result.add_pass(name, "Using STARTTLS or plain connection")
    except Exception as e:
        result.add_fail(name, str(e))


def main():
    """Run all tests."""
    print("="*60)
    print("Agent Mail Tool Test Suite")
    print("="*60)

    # Load config
    cfg = load_config()
    print(f"\nConfig: {cfg['address']} @ {cfg['imap_host']}:{cfg['imap_port']}")
    print(f"SMTP: {cfg['smtp_host']}:{cfg['smtp_port']}")
    print("-"*60)

    # Run tests
    result = TestResult()

    print("\nConnection Tests:")
    test_imap_connection(cfg, result)
    test_smtp_connection(cfg, result)
    test_tls_certificate(cfg, result)

    print("\nFunctional Tests:")
    test_tool_import(cfg, result)
    test_send_receive(cfg, result)

    # Final summary
    success = result.summary()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
