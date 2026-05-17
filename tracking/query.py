#!/usr/bin/env python3
"""
Dependency Graph Query Interface

CLI tool for querying the Autolycus dependency graph database.
"""

import os
import sys
import sqlite3
import argparse
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "depgraph.db")

def get_connection():
    """Get database connection."""
    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        print("Run build_db.py first to create the database.")
        sys.exit(1)
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def query_affects(conn, filepath):
    """Find all files that would be affected by changes to the given file."""
    cursor = conn.cursor()
    
    # Find the file
    cursor.execute("SELECT id, filepath, file_type FROM files WHERE filepath LIKE ?", (f"%{filepath}%",))
    file = cursor.fetchone()
    
    if not file:
        print(f"No file found matching '{filepath}'")
        return
    
    print(f"Analyzing impact of: {file['filepath']}")
    print("=" * 50)
    
    # Use recursive CTE to find all files that depend on this file
    query = """
    WITH RECURSIVE impact_tree AS (
        -- Anchor: start with our target file
        SELECT id, filepath, file_type, 0 AS depth
        FROM files
        WHERE id = ?
        
        UNION
        
        -- Recursive: find files that depend on files in the tree
        SELECT f.id, f.filepath, f.file_type, it.depth + 1
        FROM files f
        JOIN dependencies d ON f.id = d.source_file_id
        JOIN impact_tree it ON d.target_file_id = it.id
        WHERE it.depth < 10  -- Limit recursion depth
    )
    SELECT DISTINCT filepath, file_type, depth FROM impact_tree 
    WHERE depth > 0
    ORDER BY depth ASC, filepath
    """
    
    cursor.execute(query, (file['id'],))
    results = cursor.fetchall()
    
    if not results:
        print("No dependencies found.")
        return
    
    print(f"\nFound {len(results)} affected files:")
    print("-" * 50)
    
    current_depth = -1
    for row in results:
        if row['depth'] != current_depth:
            current_depth = row['depth']
            print(f"\nDepth {current_depth}:")
        
        print(f"  [{row['file_type']}] {row['filepath']}")
    
    print("\n" + "=" * 50)

def query_uses(conn, filepath):
    """Find all files that the given file depends on."""
    cursor = conn.cursor()
    
    # Find the file
    cursor.execute("SELECT id, filepath, file_type FROM files WHERE filepath LIKE ?", (f"%{filepath}%",))
    file = cursor.fetchone()
    
    if not file:
        print(f"No file found matching '{filepath}'")
        return
    
    print(f"Dependencies of: {file['filepath']}")
    print("=" * 50)
    
    # Find direct dependencies
    query = """
    SELECT f.filepath, f.file_type, d.dependency_type, d.line_number, d.confidence
    FROM files f
    JOIN dependencies d ON f.id = d.target_file_id
    WHERE d.source_file_id = ?
    ORDER BY d.confidence DESC, f.filepath
    """
    
    cursor.execute(query, (file['id'],))
    results = cursor.fetchall()
    
    if not results:
        print("No dependencies found.")
        return
    
    print(f"\nFound {len(results)} dependencies:")
    print("-" * 50)
    
    for row in results:
        confidence_str = f"{row['confidence']:.1f}" if row['confidence'] < 1.0 else "certain"
        print(f"  [{row['file_type']}] {row['filepath']}")
        print(f"    Type: {row['dependency_type']}, Line: {row['line_number']}, Confidence: {confidence_str}")
        print()
    
    print("=" * 50)

def query_orphans(conn):
    """Find files that have no dependencies (neither used nor using others)."""
    cursor = conn.cursor()
    
    print("Finding orphan files...")
    print("=" * 50)
    
    # Find files that appear in neither source nor target of dependencies
    query = """
    SELECT f.filepath, f.file_type, f.size
    FROM files f
    WHERE f.id NOT IN (
        SELECT DISTINCT source_file_id FROM dependencies
        UNION
        SELECT DISTINCT target_file_id FROM dependencies
    )
    AND f.file_type NOT IN ('image', 'font', 'other')
    ORDER BY f.filepath
    """
    
    cursor.execute(query)
    results = cursor.fetchall()
    
    if not results:
        print("No orphan files found.")
        return
    
    print(f"\nFound {len(results)} orphan files:")
    print("-" * 50)
    
    for row in results:
        size_kb = row['size'] / 1024
        print(f"  [{row['file_type']}] {row['filepath']} ({size_kb:.1f} KB)")
    
    print("\n" + "=" * 50)

def query_file_info(conn, filepath):
    """Get detailed information about a specific file."""
    cursor = conn.cursor()
    
    # Find the file
    cursor.execute("""
        SELECT f.*, 
               (SELECT COUNT(*) FROM dependencies WHERE source_file_id = f.id) as uses_count,
               (SELECT COUNT(*) FROM dependencies WHERE target_file_id = f.id) as used_by_count
        FROM files f 
        WHERE f.filepath LIKE ?
    """, (f"%{filepath}%",))
    
    results = cursor.fetchall()
    
    if not results:
        print(f"No file found matching '{filepath}'")
        return
    
    for file in results:
        print(f"File: {file['filepath']}")
        print(f"Type: {file['file_type']}")
        print(f"Size: {file['size']} bytes")
        print(f"Hash: {file['hash']}")
        print(f"Uses: {file['uses_count']} files")
        print(f"Used by: {file['used_by_count']} files")
        print(f"Created: {file['created_at']}")
        print(f"Updated: {file['updated_at']}")
        print("=" * 50)

def query_search(conn, search_term):
    """Search for files by name or content."""
    cursor = conn.cursor()
    
    print(f"Searching for: {search_term}")
    print("=" * 50)
    
    # Search in filepaths
    cursor.execute("""
        SELECT filepath, file_type, size 
        FROM files 
        WHERE filepath LIKE ? 
        ORDER BY filepath
        LIMIT 50
    """, (f"%{search_term}%",))
    
    filepath_results = cursor.fetchall()
    
    if filepath_results:
        print(f"\nFile matches ({len(filepath_results)}):")
        print("-" * 50)
        for row in filepath_results:
            print(f"  [{row['file_type']}] {row['filepath']}")
    
    # Search in content using FTS
    try:
        cursor.execute("""
            SELECT f.filepath, f.file_type 
            FROM files_fts fts
            JOIN files f ON f.id = fts.rowid
            WHERE fts MATCH ?
            ORDER BY rank
            LIMIT 20
        """, (search_term,))
    except:
        cursor.execute("""
            SELECT filepath, file_type 
            FROM files 
            WHERE content LIKE ?
            LIMIT 20
        """, (f"%{search_term}%",))
    
    content_results = cursor.fetchall()
    
    if content_results:
        print(f"\nContent matches ({len(content_results)}):")
        print("-" * 50)
        for row in content_results:
            print(f"  [{row['file_type']}] {row['filepath']}")
    
    print("\n" + "=" * 50)

def main():
    parser = argparse.ArgumentParser(description="Query Autolycus dependency graph")
    parser.add_argument("--affects", type=str, help="Find files affected by changes to this file")
    parser.add_argument("--uses", type=str, help="Find files that this file depends on")
    parser.add_argument("--orphans", action="store_true", help="Find orphan files with no dependencies")
    parser.add_argument("--info", type=str, help="Get detailed information about a file")
    parser.add_argument("--search", type=str, help="Search for files by name or content")
    
    args = parser.parse_args()
    
    if not any([args.affects, args.uses, args.orphans, args.info, args.search]):
        parser.print_help()
        return
    
    conn = get_connection()
    
    try:
        if args.affects:
            query_affects(conn, args.affects)
        elif args.uses:
            query_uses(conn, args.uses)
        elif args.orphans:
            query_orphans(conn)
        elif args.info:
            query_file_info(conn, args.info)
        elif args.search:
            query_search(conn, args.search)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
