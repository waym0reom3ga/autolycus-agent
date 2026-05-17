#!/usr/bin/env python3
"""
Autolycus Dependency Graph Database Builder

This script crawls the entire Autolycus codebase and builds an SQLite database
tracking all files, their types, content, and dependencies.

Usage:
    python3 build_db.py [--rebuild] [--path PATH]

Options:
    --rebuild   Start fresh (drop existing tables)
    --path      Path to codebase (default: ../..)
"""

import os
import sys
import sqlite3
import hashlib
import argparse
from pathlib import Path
from datetime import datetime

# Import our indexer modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl import FileCrawler
from analyze_python import PythonAnalyzer
from analyze_generic import GenericAnalyzer

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "depgraph.db")

# Gitignore patterns to skip
GITIGNORE_PATTERNS = [
    ".git/",
    "__pycache__/",
    ".venv/",
    "venv/",
    "node_modules/",
    ".pytest_cache/",
    ".mypy_cache/",
    "*.pyc",
    "*.pyo",
    ".DS_Store",
    "*.egg-info/",
    "dist/",
    "build/",
    ".tox/",
    ".nox/",
]

def should_skip(filepath, patterns):
    """Check if a filepath should be skipped based on ignore patterns."""
    for pattern in patterns:
        if pattern.startswith("*"):
            # Glob pattern
            if filepath.endswith(pattern[1:]):
                return True
        elif pattern in filepath:
            return True
    return False

def get_file_type(filepath):
    """Determine file type based on extension."""
    ext = Path(filepath).suffix.lower()
    name = Path(filepath).name.lower()
    
    if ext == ".py":
        return "python"
    elif ext in [".json", ".yaml", ".yml"]:
        return "config"
    elif ext in [".sh", ".bash"]:
        return "shell"
    elif name in ["dockerfile", "dockerfile.*"]:
        return "dockerfile"
    elif ext == ".md":
        return "markdown"
    elif ext in [".js", ".jsx", ".ts", ".tsx"]:
        return "javascript"
    elif ext == ".toml":
        return "toml"
    elif ext == ".txt":
        return "text"
    elif ext in [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico"]:
        return "image"
    elif ext in [".woff", ".woff2", ".ttf", ".eot"]:
        return "font"
    else:
        return "other"

def create_database(db_path, rebuild=False):
    """Create the SQLite database and schema."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Enable WAL mode for better concurrent access
    cursor.execute("PRAGMA journal_mode=WAL")
    
    if rebuild:
        print("Rebuilding database...")
        cursor.execute("DROP TABLE IF EXISTS dependencies")
        cursor.execute("DROP TABLE IF EXISTS files")
    
    # Create tables
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filepath TEXT UNIQUE NOT NULL,
            file_type TEXT NOT NULL,
            size INTEGER,
            hash TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dependencies (
            source_file_id INTEGER,
            target_file_id INTEGER,
            dependency_type TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            line_number INTEGER,
            detail TEXT,
            PRIMARY KEY (source_file_id, target_file_id, dependency_type),
            FOREIGN KEY (source_file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (target_file_id) REFERENCES files(id) ON DELETE CASCADE
        )
    """)
    
    # Create indexes for faster queries
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_files_filepath 
        ON files(filepath)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_files_type 
        ON files(file_type)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_deps_source 
        ON dependencies(source_file_id)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_deps_target 
        ON dependencies(target_file_id)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_deps_type 
        ON dependencies(dependency_type)
    """)
    
    # Create full-text search index
    cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts 
        USING fts5(filepath, content, content='files', content_rowid='id')
    """)
    
    conn.commit()
    return conn

def populate_database(conn, codebase_path):
    """Crawl the codebase and populate the database."""
    cursor = conn.cursor()
    
    # Check if database is already populated
    cursor.execute("SELECT COUNT(*) FROM files")
    count = cursor.fetchone()[0]
    
    if count > 0:
        print(f"Database already contains {count} files. Skipping crawl.")
        return
    
    print(f"Crawling codebase at {codebase_path}...")
    
    crawler = FileCrawler(codebase_path)
    files = crawler.crawl()
    
    print(f"Found {len(files)} files. Inserting into database...")
    
    # Insert files
    for i, file_info in enumerate(files):
        if should_skip(file_info['filepath'], GITIGNORE_PATTERNS):
            continue
            
        # Read content for text files
        content = None
        try:
            if file_info['file_type'] in ['python', 'config', 'shell', 'markdown', 'javascript', 'toml', 'text']:
                with open(file_info['full_path'], 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
        except:
            pass
        
        cursor.execute("""
            INSERT OR REPLACE INTO files (filepath, file_type, size, hash, content)
            VALUES (?, ?, ?, ?, ?)
        """, (
            file_info['filepath'],
            file_info['file_type'],
            file_info['size'],
            file_info['hash'],
            content
        ))
        
        if (i + 1) % 1000 == 0:
            print(f"  Inserted {i + 1}/{len(files)} files...")
            conn.commit()
    
    conn.commit()
    print("File insertion complete.")
    
    # Analyze dependencies
    print("Analyzing Python dependencies...")
    python_analyzer = PythonAnalyzer(conn, codebase_path)
    python_analyzer.analyze()
    
    print("Analyzing generic dependencies...")
    generic_analyzer = GenericAnalyzer(conn, codebase_path)
    generic_analyzer.analyze()
    
    # Update FTS index
    print("Updating full-text search index...")
    try:
        cursor.execute("DELETE FROM files_fts")
        cursor.execute("""
            INSERT INTO files_fts (rowid, filepath, content)
            SELECT id, filepath, content FROM files WHERE content IS NOT NULL
        """)
        conn.commit()
    except Exception as e:
        print(f"  Warning: FTS index update failed: {e}")
        print("  Continuing without FTS...")
    
    print("Database population complete.")

def main():
    parser = argparse.ArgumentParser(description="Build Autolycus dependency graph database")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild database from scratch")
    parser.add_argument("--path", default="../..", help="Path to codebase (default: ../..)")
    args = parser.parse_args()
    
    codebase_path = os.path.abspath(args.path)
    if not os.path.exists(codebase_path):
        print(f"Error: Codebase path {codebase_path} does not exist")
        sys.exit(1)
    
    print(f"Building dependency graph for {codebase_path}")
    print(f"Database will be stored at {DB_PATH}")
    
    # Create database
    conn = create_database(DB_PATH, rebuild=args.rebuild)
    
    try:
        # Populate database
        populate_database(conn, codebase_path)
        
        # Print summary
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM files")
        file_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM dependencies")
        dep_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT file_type, COUNT(*) FROM files GROUP BY file_type ORDER BY COUNT(*) DESC")
        type_counts = cursor.fetchall()
        
        print("\n" + "="*50)
        print("DATABASE SUMMARY")
        print("="*50)
        print(f"Total files: {file_count}")
        print(f"Total dependencies: {dep_count}")
        print("\nFile types:")
        for file_type, count in type_counts:
            print(f"  {file_type}: {count}")
        print("="*50)
        
    finally:
        conn.close()

if __name__ == "__main__":
    main()
