#!/usr/bin/env python3
"""
Runtime Dependency Analyzer

Detects runtime-discovered dependencies that static analysis misses:
- Plugin directories loaded by discover_plugins()
- Optional skills scanned by gateway/run.py
- Skills synced by skills_sync
- Locale files loaded by i18n system
- Config files loaded at runtime

This supplements the static AST/regex analysis with actual runtime behavior.
"""

import os
import re
import sqlite3
from pathlib import Path

def analyze_runtime_dependencies(conn, codebase_path):
    """Analyze runtime-discovered dependencies and add them to the database."""
    cursor = conn.cursor()
    
    print("Analyzing runtime dependencies...")
    
    # 1. Plugins directory - loaded by hermes_cli/plugins.py via get_bundled_plugins_dir()
    add_directory_dependency(cursor, "plugins/", "hermes_cli/plugins.py", 
                           "plugin_discovery", "Loaded by discover_plugins() at runtime", 1.0)
    add_directory_dependency(cursor, "plugins/", "hermes_cli/main.py",
                           "plugin_discovery", "Plugin CLI commands registered at startup", 1.0)
    
    # 2. Skills directory - synced by tools/skills_sync.py
    add_directory_dependency(cursor, "skills/", "tools/skills_sync.py",
                           "skill_sync", "Bundled skills synced to ~/.hermes/skills/ on every launch", 1.0)
    add_directory_dependency(cursor, "skills/", "hermes_cli/main.py",
                           "skill_sync", "sync_skills() called on CLI startup", 1.0)
    
    # 3. Optional skills - scanned by gateway/run.py
    add_directory_dependency(cursor, "optional-skills/", "gateway/run.py",
                           "optional_skill_scan", "Scanned when skill requested but not installed", 1.0)
    add_directory_dependency(cursor, "optional-skills/", "hermes_cli/claw.py",
                           "optional_skill_scan", "OpenClaw migration script location", 0.9)
    add_directory_dependency(cursor, "optional-skills/", "hermes_cli/setup.py",
                           "optional_skill_scan", "OpenClaw migration script location", 0.9)
    add_directory_dependency(cursor, "optional-skills/", "hermes_cli/skills_hub.py",
                           "skill_hub_source", "Official skills listed in Skills Hub", 0.9)
    
    # 4. Locales - loaded by i18n system
    add_directory_dependency(cursor, "locales/", "hermes_cli/stdio.py",
                           "i18n_locale", "Locale configuration for stdio encoding", 0.8)
    add_directory_dependency(cursor, "locales/", "ui-tui/src/i18n/",
                           "i18n_locale", "TUI internationalization translations", 0.8)
    add_directory_dependency(cursor, "locales/", "web/src/i18n/",
                           "i18n_locale", "Web dashboard internationalization", 0.8)
    
    # 5. Docker files - used by Dockerfile
    add_file_dependency(cursor, "docker/entrypoint.sh", "Dockerfile",
                       "docker_entrypoint", "ENTRYPOINT command", 1.0)
    add_file_dependency(cursor, "docker-compose.yml", "Dockerfile",
                       "docker_compose", "Docker compose configuration", 0.9)
    add_file_dependency(cursor, ".dockerignore", "Dockerfile",
                       "docker_ignore", "Docker build context exclusion", 0.9)
    
    # 6. Website - Docusaurus docs site
    add_directory_dependency(cursor, "website/", "website/docusaurus.config.ts",
                           "docs_site", "Docusaurus documentation site", 0.7)
    
    # 7. UI-TUI - Hermes TUI components
    add_directory_dependency(cursor, "ui-tui/", "hermes_cli/main.py",
                           "tui_components", "TUI JavaScript components built at install", 0.8)
    
    # 8. Web dashboard
    add_directory_dependency(cursor, "web/", "hermes_cli/main.py",
                           "web_dashboard", "Web dashboard built at install time", 0.8)
    
    # 9. Tests - test suite
    add_directory_dependency(cursor, "tests/", "pyproject.toml",
                           "test_suite", "Test suite referenced in project config", 0.7)
    
    # 10. Tools - utility scripts
    add_directory_dependency(cursor, "tools/", "hermes_cli/main.py",
                           "utility_tools", "Utility tools loaded as needed", 0.7)
    
    # 11. Scripts - setup/automation
    add_directory_dependency(cursor, "scripts/", "hermes_cli/setup.py",
                           "setup_scripts", "Setup and automation scripts", 0.7)
    
    conn.commit()
    print("Runtime dependency analysis complete.")

def add_directory_dependency(cursor, directory, source_file, dep_type, detail, confidence):
    """Add a dependency from a source file to all files in a directory."""
    # Get source file ID
    cursor.execute("SELECT id FROM files WHERE filepath = ?", (source_file,))
    source_result = cursor.fetchone()
    
    if not source_result:
        # Try partial match
        cursor.execute("SELECT id FROM files WHERE filepath LIKE ?", (f"%{source_file}%",))
        source_result = cursor.fetchone()
    
    if not source_result:
        return
    
    source_id = source_result[0]
    
    # Get all files in directory
    cursor.execute("SELECT id FROM files WHERE filepath LIKE ?", (f"{directory}%",))
    target_files = cursor.fetchall()
    
    for (target_id,) in target_files:
        cursor.execute("""
            INSERT OR IGNORE INTO dependencies 
            (source_file_id, target_file_id, dependency_type, confidence, detail)
            VALUES (?, ?, ?, ?, ?)
        """, (source_id, target_id, dep_type, confidence, detail))

def add_file_dependency(cursor, target_file, source_file, dep_type, detail, confidence):
    """Add a dependency between two specific files."""
    cursor.execute("SELECT id FROM files WHERE filepath = ?", (source_file,))
    source_result = cursor.fetchone()
    
    cursor.execute("SELECT id FROM files WHERE filepath = ?", (target_file,))
    target_result = cursor.fetchone()
    
    if source_result and target_result:
        cursor.execute("""
            INSERT OR IGNORE INTO dependencies 
            (source_file_id, target_file_id, dependency_type, confidence, detail)
            VALUES (?, ?, ?, ?, ?)
        """, (source_result[0], target_result[0], dep_type, confidence, detail))

def main():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "depgraph.db")
    codebase_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        print("Run build_db.py first.")
        sys.exit(1)
    
    conn = sqlite3.connect(db_path)
    try:
        analyze_runtime_dependencies(conn, codebase_path)
        
        # Print summary
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM dependencies")
        total_deps = cursor.fetchone()[0]
        print(f"\nTotal dependencies in database: {total_deps}")
        
    finally:
        conn.close()

if __name__ == "__main__":
    main()
