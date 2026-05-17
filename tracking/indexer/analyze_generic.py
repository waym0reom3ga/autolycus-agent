#!/usr/bin/env python3
"""
Generic Dependency Analyzer

Analyzes non-Python files (YAML, JSON, shell scripts, Dockerfiles, etc.)
for dependencies using regex patterns and content analysis.
"""

import os
import re
import sqlite3
import json
import yaml
from pathlib import Path

class GenericAnalyzer:
    """Analyze generic files for dependencies using regex and content parsing."""
    
    def __init__(self, db_connection, codebase_path):
        self.conn = db_connection
        self.cursor = db_connection.cursor()
        self.codebase_path = codebase_path
        
    def analyze(self):
        """Analyze all non-Python files in the codebase."""
        # Get all files to analyze
        self.cursor.execute("""
            SELECT id, filepath, file_type FROM files 
            WHERE file_type IN ('config', 'shell', 'dockerfile', 'markdown', 'javascript', 'toml', 'text')
            AND content IS NOT NULL
        """)
        files = self.cursor.fetchall()
        
        print(f"Analyzing {len(files)} generic files...")
        
        for file_id, filepath, file_type in files:
            try:
                full_path = os.path.join(self.codebase_path, filepath)
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                
                # Analyze based on file type
                if file_type == 'config':
                    self._analyze_config(file_id, filepath, content)
                elif file_type == 'shell':
                    self._analyze_shell(file_id, filepath, content)
                elif file_type == 'dockerfile':
                    self._analyze_dockerfile(file_id, filepath, content)
                elif file_type == 'markdown':
                    self._analyze_markdown(file_id, filepath, content)
                elif file_type == 'javascript':
                    self._analyze_javascript(file_id, filepath, content)
                    
            except Exception as e:
                print(f"  Error analyzing {filepath}: {e}")
        
        self.conn.commit()
        print("Generic analysis complete.")
    
    def _analyze_config(self, file_id, filepath, content):
        """Analyze configuration files (YAML, JSON)."""
        # Look for file references in config
        file_patterns = [
            r'["\']([^"\']+\.(?:py|yaml|yml|json|sh|toml|md))["\']',
            r'file:\s*["\']?([^"\'\s]+)["\']?',
            r'path:\s*["\']?([^"\'\s]+)["\']?',
            r'source:\s*["\']?([^"\'\s]+)["\']?',
            r'target:\s*["\']?([^"\'\s]+)["\']?',
        ]
        
        for pattern in file_patterns:
            matches = re.finditer(pattern, content)
            for match in matches:
                referenced_file = match.group(1)
                line_num = content[:match.start()].count('\n') + 1
                
                # Check if referenced file exists
                self.cursor.execute("SELECT id FROM files WHERE filepath LIKE ?", (f"%{referenced_file}%",))
                result = self.cursor.fetchone()
                
                if result:
                    target_id = result[0]
                    self.cursor.execute("""
                        INSERT OR IGNORE INTO dependencies 
                        (source_file_id, target_file_id, dependency_type, line_number, confidence)
                        VALUES (?, ?, 'config_reference', ?, 0.7)
                    """, (file_id, target_id, line_num))
    
    def _analyze_shell(self, file_id, filepath, content):
        """Analyze shell scripts for dependencies."""
        # Look for script execution, source commands, and file references
        patterns = [
            (r'source\s+["\']?([^"\'\s]+)', 'shell_source'),
            (r'\.+\s+["\']?([^"\'\s]+\.sh)', 'shell_source'),
            (r'python[3]?\s+["\']?([^"\'\s]+\.py)', 'shell_python_call'),
            (r'pip\s+install\s+["\']?([^"\'\s<>]+)', 'shell_pip_install'),
            (r'cd\s+["\']?([^"\'\s]+)', 'shell_directory'),
        ]
        
        for pattern, dep_type in patterns:
            matches = re.finditer(pattern, content)
            for match in matches:
                reference = match.group(1)
                line_num = content[:match.start()].count('\n') + 1
                
                # For file references, check if they exist
                if dep_type in ['shell_source', 'shell_python_call']:
                    self.cursor.execute("SELECT id FROM files WHERE filepath LIKE ?", (f"%{reference}%",))
                    result = self.cursor.fetchone()
                    
                    if result:
                        target_id = result[0]
                        self.cursor.execute("""
                            INSERT OR IGNORE INTO dependencies 
                            (source_file_id, target_file_id, dependency_type, line_number, confidence)
                            VALUES (?, ?, ?, ?, 0.8)
                        """, (file_id, target_id, dep_type, line_num))
    
    def _analyze_dockerfile(self, file_id, filepath, content):
        """Analyze Dockerfiles for dependencies."""
        # Look for COPY, ADD, and WORKDIR commands
        patterns = [
            (r'(?:COPY|ADD)\s+([^\\]+?)(?:\s+[^\\]+)?$', 'dockerfile_copy'),
            (r'WORKDIR\s+([^\\]+)', 'dockerfile_workdir'),
            (r'CMD\s+["\']([^"\']+)["\']', 'dockerfile_cmd'),
            (r'ENTRYPOINT\s+["\']([^"\']+)["\']', 'dockerfile_entrypoint'),
        ]
        
        lines = content.split('\n')
        for i, line in enumerate(lines):
            for pattern, dep_type in patterns:
                matches = re.finditer(pattern, line)
                for match in matches:
                    reference = match.group(1).strip()
                    
                    # Check if reference points to a file
                    if reference and not reference.startswith('.'):
                        self.cursor.execute("SELECT id FROM files WHERE filepath LIKE ?", (f"%{reference}%",))
                        result = self.cursor.fetchone()
                        
                        if result:
                            target_id = result[0]
                            self.cursor.execute("""
                                INSERT OR IGNORE INTO dependencies 
                                (source_file_id, target_file_id, dependency_type, line_number, confidence)
                                VALUES (?, ?, ?, ?, 0.9)
                            """, (file_id, target_id, dep_type, i + 1))
    
    def _analyze_markdown(self, file_id, filepath, content):
        """Analyze markdown files for code references."""
        # Look for code blocks and file references
        patterns = [
            (r'```(\w+)', 'markdown_code_block'),
            (r'\[([^\]]+)\]\(([^)]+)\)', 'markdown_link'),
            (r'`([^`]+\.(?:py|yaml|yml|json|sh))`', 'markdown_code_ref'),
        ]
        
        for pattern, dep_type in patterns:
            matches = re.finditer(pattern, content)
            for match in matches:
                reference = match.group(2 if dep_type == 'markdown_link' else 1)
                line_num = content[:match.start()].count('\n') + 1
                
                # For file references, check if they exist
                if dep_type == 'markdown_code_ref':
                    self.cursor.execute("SELECT id FROM files WHERE filepath LIKE ?", (f"%{reference}%",))
                    result = self.cursor.fetchone()
                    
                    if result:
                        target_id = result[0]
                        self.cursor.execute("""
                            INSERT OR IGNORE INTO dependencies 
                            (source_file_id, target_file_id, dependency_type, line_number, confidence)
                            VALUES (?, ?, ?, ?, 0.6)
                        """, (file_id, target_id, dep_type, line_num))
    
    def _analyze_javascript(self, file_id, filepath, content):
        """Analyze JavaScript files for imports."""
        # Look for require() and import statements
        patterns = [
            (r'require\s*\(\s*["\']([^"\']+)["\']\s*\)', 'js_require'),
            (r'import\s+.*?\s+from\s+["\']([^"\']+)["\']', 'js_import'),
            (r'import\s*\(\s*["\']([^"\']+)["\']\s*\)', 'js_dynamic_import'),
        ]
        
        for pattern, dep_type in patterns:
            matches = re.finditer(pattern, content)
            for match in matches:
                reference = match.group(1)
                line_num = content[:match.start()].count('\n') + 1
                
                # Check if reference points to a file
                self.cursor.execute("SELECT id FROM files WHERE filepath LIKE ?", (f"%{reference}%",))
                result = self.cursor.fetchone()
                
                if result:
                    target_id = result[0]
                    self.cursor.execute("""
                        INSERT OR IGNORE INTO dependencies 
                        (source_file_id, target_file_id, dependency_type, line_number, confidence)
                        VALUES (?, ?, ?, ?, 0.8)
                    """, (file_id, target_id, dep_type, line_num))
