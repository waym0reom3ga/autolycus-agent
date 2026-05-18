# Autolycus Dependency Graph Tracker

This system tracks all files in the Autolycus codebase and maps their dependencies to help with:
- Impact analysis before changes
- Identifying orphan files that can be safely removed
- Understanding code relationships
- Quality control before releases

## Directory Structure

```
tracking/
├── depgraph.db          ← SQLite database (generated)
├── indexer/
│   ├── crawl.py         ← Walks directories, registers all files
│   ├── analyze_python.py ← AST-based Python import/usage extraction
│   ├── analyze_generic.py ← Regex-based analysis for YAML/JSON/shell/Dockerfiles
│   ├── analyze_runtime.py ← Runtime discovery analysis (plugins, skills, locales)
│   └── build_db.py      ← Orchestrates the entire indexing process
└── query.py             ← CLI query interface for the dependency graph
```

## Dependency Types

The database tracks three types of dependencies:

1. **Static imports** (confidence: 1.0) - Python AST analysis of import statements
2. **File references** (confidence: 0.6-0.9) - Regex-based detection of file paths in configs, shell scripts, etc.
3. **Runtime discovery** (confidence: 0.7-1.0) - Files loaded at runtime by discovery mechanisms:
   - `plugins/` - Loaded by `hermes_cli/plugins.py` via `discover_plugins()`
   - `skills/` - Synced by `tools/skills_sync.py` on every CLI launch
   - `optional-skills/` - Scanned by `gateway/run.py` when skills are requested
   - `locales/` - Loaded by i18n system for TUI and web dashboard

## Setup

1. Install required dependencies:
```bash
pip install pyyaml
```

2. Build the database:
```bash
cd tracking/indexer
python3 build_db.py --rebuild
```

## Usage

### Building the Database

```bash
# Build from scratch
python3 build_db.py --rebuild

# Update existing database
python3 build_db.py

# Specify custom codebase path
python3 build_db.py --path /path/to/codebase
```

### Querying the Database

```bash
cd tracking

# Find files affected by changes to a specific file
python3 query.py --affects "hermes/core.py"

# Find dependencies of a specific file
python3 query.py --uses "hermes/core.py"

# Find orphan files (no dependencies)
python3 query.py --orphans

# Get detailed file information
python3 query.py --info "hermes/core.py"

# Search for files by name or content
python3 query.py --search "docker"
```

## Database Schema

### Files Table
- `id`: Primary key
- `filepath`: Relative path from codebase root
- `file_type`: Type of file (python, config, shell, etc.)
- `size`: File size in bytes
- `hash`: SHA256 hash of file content
- `content`: File content (for text files)
- `created_at`: Timestamp when record was created
- `updated_at`: Timestamp when record was last updated

### Dependencies Table
- `source_file_id`: File that has the dependency
- `target_file_id`: File that is depended upon
- `dependency_type`: Type of dependency (import, config_reference, etc.)
- `confidence`: Confidence score (0.0-1.0) of the dependency
- `line_number`: Line number where dependency is referenced
- `detail`: Additional details about the dependency

## Query Examples

### Impact Analysis
Find all files that would be affected by changes to a configuration file:
```bash
python3 query.py --affects "config/settings.yaml"
```

### Dependency Chain
Find what a specific module depends on:
```bash
python3 query.py --uses "hermes/agent.py"
```

### Cleanup Candidates
Find files that are not connected to the rest of the codebase:
```bash
python3 query.py --orphans
```

## Confidence Scores

- **1.0 (certain)**: AST-proven dependencies (Python imports)
- **0.9**: Explicit file references (Dockerfile COPY/ADD)
- **0.8**: Direct script calls or source commands
- **0.7**: Configuration file references
- **0.6**: Markdown code references
- **0.5**: Pattern-matched references (inferred)

## Maintenance

Run the indexer before each release to ensure the dependency graph is up-to-date:
```bash
python3 build_db.py
```

The database uses WAL mode for better concurrent access performance.
