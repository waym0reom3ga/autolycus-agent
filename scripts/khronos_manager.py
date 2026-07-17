#!/usr/bin/env python3
"""Khronos server manager - starts/stops/monitors the Khronos workflow server."""

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

KHRONOS_BIN = os.path.expanduser("~/khronos/target/release/khronos")
DATA_DIR = os.path.expanduser("~/.khronos/data")
PID_FILE = os.path.expanduser("~/.autolycus/khronos.pid")
LOG_FILE = os.path.expanduser("~/.autolycus/logs/khronos.log")
PORT = 7233
STARTUP_TIMEOUT = 10  # seconds to wait for Khronos to become ready


def log(msg):
    print(f"[khronos] {msg}", file=sys.stderr)


def is_listening(port):
    """Check if a port is actively listening."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            result = s.connect_ex(('127.0.0.1', port))
            return result == 0
    except Exception:
        return False


def read_pid():
    """Read the stored PID file."""
    try:
        with open(PID_FILE, 'r') as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def write_pid(pid):
    """Write the PID file."""
    Path(PID_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(PID_FILE, 'w') as f:
        f.write(str(pid))


def remove_pid():
    """Remove the PID file."""
    try:
        Path(PID_FILE).unlink(missing_ok=True)
    except Exception:
        pass


def is_running(pid):
    """Check if a process with the given PID is running."""
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def health_check():
    """Run health checks on Khronos."""
    results = []
    
    # Check 1: Process is running
    pid = read_pid()
    if pid is None:
        results.append(("PID file", "FAIL", "No PID file found"))
    elif not is_running(pid):
        results.append(("Process", "FAIL", f"PID {pid} is not running"))
    else:
        results.append(("Process", "OK", f"Running as PID {pid}"))
    
    # Check 2: Port is listening
    if is_listening(PORT):
        results.append(("gRPC port", "OK", f"Listening on port {PORT}"))
    else:
        results.append(("gRPC port", "FAIL", f"Port {PORT} not responding"))
    
    # Check 3: Database is accessible
    try:
        import sqlite3
        db_path = os.path.join(DATA_DIR, "khronos.db")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM schedules")
        schedule_count = cursor.fetchone()[0]
        cursor.execute("SELECT state, COUNT(*) FROM workflows GROUP BY state")
        workflow_states = dict(cursor.fetchall())
        conn.close()
        results.append(("Database", "OK", f"{schedule_count} schedules, workflows: {workflow_states}"))
    except Exception as e:
        results.append(("Database", "FAIL", str(e)))
    
    # Check 4: No stuck workflows
    try:
        import sqlite3
        db_path = os.path.join(DATA_DIR, "khronos.db")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM workflows WHERE state='running' AND started_at < datetime('now', '-2 hours')")
        stuck_count = cursor.fetchone()[0]
        conn.close()
        if stuck_count > 0:
            results.append(("Stuck workflows", "WARN", f"{stuck_count} workflows stuck for >2 hours"))
        else:
            results.append(("Stuck workflows", "OK", "None"))
    except Exception as e:
        results.append(("Stuck workflows", "FAIL", str(e)))
    
    return results


def start():
    """Start the Khronos server."""
    # Check if already running
    pid = read_pid()
    if pid and is_running(pid):
        log(f"Already running as PID {pid}")
        return True
    
    # Check binary exists
    if not os.path.exists(KHRONOS_BIN):
        log(f"Binary not found: {KHRONOS_BIN}")
        return False
    
    # Ensure log directory exists
    Path(LOG_FILE).parent.mkdir(parents=True, exist_ok=True)
    
    # Start the process
    log("Starting Khronos server...")
    try:
        with open(LOG_FILE, 'a') as log_file:
            process = subprocess.Popen(
                [KHRONOS_BIN, "--port", str(PORT), "--data-dir", DATA_DIR],
                stdout=log_file,
                stderr=log_file,
                start_new_session=True  # Detach from parent
            )
        write_pid(process.pid)
        log(f"Started with PID {process.pid}")
        
        # Wait for it to become ready
        for i in range(STARTUP_TIMEOUT):
            time.sleep(1)
            if is_listening(PORT):
                log("Server is ready")
                return True
        
        log(f"Warning: Server started but port {PORT} not responding after {STARTUP_TIMEOUT}s")
        return True  # Still consider it started - it might be initializing
    
    except Exception as e:
        log(f"Failed to start: {e}")
        remove_pid()
        return False


def stop():
    """Stop the Khronos server."""
    pid = read_pid()
    if pid and is_running(pid):
        log(f"Stopping PID {pid}...")
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(2)
            if is_running(pid):
                os.kill(pid, signal.SIGKILL)
            log("Stopped")
        except Exception as e:
            log(f"Error stopping: {e}")
        finally:
            remove_pid()
    else:
        log("Not running")
        remove_pid()
    return True


def status():
    """Show Khronos status."""
    pid = read_pid()
    if pid and is_running(pid):
        print(f"Khronos: RUNNING (PID {pid})")
        if is_listening(PORT):
            print(f"  gRPC: LISTENING on port {PORT}")
        else:
            print(f"  gRPC: NOT RESPONDING on port {PORT}")
    else:
        print("Khronos: STOPPED")
        remove_pid()


def main():
    if len(sys.argv) < 2:
        print("Usage: khronos_manager.py {start|stop|restart|status|health}")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "start":
        success = start()
        sys.exit(0 if success else 1)
    elif command == "stop":
        stop()
    elif command == "restart":
        stop()
        time.sleep(1)
        start()
    elif command == "status":
        status()
    elif command == "health":
        results = health_check()
        for check, check_status, detail in results:
            print(f"{check}: {check_status} - {detail}")
        # Exit with error if any checks failed
        has_failures = any(check_status == "FAIL" for _, check_status, _ in results)
        sys.exit(1 if has_failures else 0)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
