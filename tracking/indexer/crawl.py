#!/usr/bin/env python3
"""
File Crawler Module

Walks the directory tree and collects information about all files.
"""

import os
import hashlib
from pathlib import Path

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
    elif name.startswith("dockerfile"):
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

def compute_hash(filepath):
    """Compute SHA256 hash of a file."""
    try:
        hasher = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                hasher.update(chunk)
        return hasher.hexdigest()
    except:
        return None

class FileCrawler:
    """Crawl a directory tree and collect file information."""
    
    def __init__(self, root_path):
        self.root_path = root_path
        self.files = []
        
    def crawl(self):
        """Walk the directory tree and collect file information."""
        for root, dirs, files in os.walk(self.root_path):
            # Skip hidden directories and common non-source directories
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in [
                '__pycache__', 'node_modules', '.git', '.venv', 'venv',
                '.pytest_cache', '.mypy_cache', 'dist', 'build', '.tox', '.nox'
            ]]
            
            for filename in files:
                filepath = os.path.join(root, filename)
                rel_path = os.path.relpath(filepath, self.root_path)
                
                try:
                    stat = os.stat(filepath)
                    file_info = {
                        'filepath': rel_path,
                        'full_path': filepath,
                        'file_type': get_file_type(filepath),
                        'size': stat.st_size,
                        'hash': compute_hash(filepath),
                        'modified': stat.st_mtime
                    }
                    self.files.append(file_info)
                except (OSError, PermissionError):
                    # Skip files we can't access
                    pass
        
        return self.files
