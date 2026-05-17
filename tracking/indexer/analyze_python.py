#!/usr/bin/env python3
"""
Python Dependency Analyzer

Uses Python's AST module to extract imports and dependencies from Python files.
"""

import ast
import os
import sqlite3
from pathlib import Path

class PythonAnalyzer:
    """Analyze Python files for dependencies using AST parsing."""
    
    def __init__(self, db_connection, codebase_path):
        self.conn = db_connection
        self.cursor = db_connection.cursor()
        self.codebase_path = codebase_path
        
    def analyze(self):
        """Analyze all Python files in the codebase."""
        # Get all Python files from database
        self.cursor.execute("SELECT id, filepath FROM files WHERE file_type = 'python'")
        python_files = self.cursor.fetchall()
        
        print(f"Analyzing {len(python_files)} Python files...")
        
        for file_id, filepath in python_files:
            try:
                full_path = os.path.join(self.codebase_path, filepath)
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                
                # Parse AST
                tree = ast.parse(content, filename=filepath)
                
                # Extract imports
                imports = self._extract_imports(tree)
                
                # Record dependencies
                for import_name, line_number in imports:
                    self._record_dependency(file_id, import_name, "import", line_number)
                    
            except SyntaxError:
                # Skip files with syntax errors
                pass
            except Exception as e:
                print(f"  Error analyzing {filepath}: {e}")
        
        self.conn.commit()
        print("Python analysis complete.")
    
    def _extract_imports(self, tree):
        """Extract imports from AST tree."""
        imports = []
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append((alias.name, node.lineno))
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.append((node.module, node.lineno))
        
        return imports
    
    def _record_dependency(self, source_file_id, import_name, dep_type, line_number):
        """Record a dependency in the database."""
        # Convert import name to potential file path
        target_path = self._import_to_path(import_name)
        
        if target_path:
            # Check if target file exists in database
            self.cursor.execute("SELECT id FROM files WHERE filepath = ?", (target_path,))
            result = self.cursor.fetchone()
            
            if result:
                target_file_id = result[0]
                
                # Insert dependency if not exists
                self.cursor.execute("""
                    INSERT OR IGNORE INTO dependencies 
                    (source_file_id, target_file_id, dependency_type, line_number, confidence)
                    VALUES (?, ?, ?, ?, 1.0)
                """, (source_file_id, target_file_id, dep_type, line_number))
    
    def _import_to_path(self, import_name):
        """Convert an import statement to a file path."""
        # Handle relative imports
        if import_name.startswith('.'):
            return None
            
        # Convert module path to file path
        parts = import_name.split('.')
        for i in range(len(parts), 0, -1):
            candidate = '/'.join(parts[:i]) + '.py'
            # Check if this file exists in the database
            self.cursor.execute("SELECT id FROM files WHERE filepath = ?", (candidate,))
            if self.cursor.fetchone():
                return candidate
        
        # Try as directory with __init__.py
        candidate = '/'.join(parts) + '/__init__.py'
        self.cursor.execute("SELECT id FROM files WHERE filepath = ?", (candidate,))
        if self.cursor.fetchone():
            return candidate
        
        return None
