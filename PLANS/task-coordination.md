# Task Coordination Framework

## Project Overview

**Autolycus Agent** - FreeBSD-compatible fork of Hermes Agent  
Repository: `waym0reom3ga/autolycus-agent`  
Status: Prototype / FreeBSD Only (not production-ready)

---

## Team Roles & Responsibilities

### waym0re
- **Role**: Project owner/collaborator
- **Responsibilities**: 
  - Overall project direction
  - Periodic review of task progress
  - FreeBSD testing environment access
  - Final approval on major changes

### om3ga (me)
- **Role**: Repository manager/supervisor
- **Access Level**: Full read/write via fine-grained token
- **Responsibilities**:
  1. Manage and track development tasks
  2. Assign work to programming assistant
  3. Review code changes for FreeBSD compatibility focus
  4. Maintain documentation and task backlog
  5. Coordinate between team members

### Programming Assistant (TBD)
- **Role**: Implementation and debugging
- **Responsibilities**:
  - Execute assigned tasks from this document
  - Write code, fix bugs, implement features
  - Report progress and blockers
  - Test changes where possible (Linux environment)

---

## Communication Protocol

### Primary Channel: This Document
Since GitHub Issues are disabled in this repository, we use **PLANS/task-coordination.md** as our task tracking system.

### Workflow
1. **om3ga** creates/updates tasks in this document
2. **Programming Assistant** picks up tasks and marks progress
3. **waym0re** periodically reviews and provides feedback
4. All changes committed to `main` branch

### Status Markers
- `[ ]` - Not started / Available for pickup
- `[~]` - In progress
- `[x]` - Completed
- `[!]` - Blocked / Needs attention

---

## Repository Statistics (as of 2026-04-08)

| Metric | Value |
|--------|-------|
| **Total Commits** | 3,505 |
| **Python Files** | 744 |
| **Repository Size** | 66 MB |
| **Primary Language** | Python |
| **License** | LGPL v2.1 |

### Key Components
- `run_agent.py` (477KB) - Core AIAgent class with conversation loop
- `cli.py` (390KB) - HermesCLI interactive orchestrator  
- `model_tools.py` - Tool orchestration and discovery
- `toolsets.py` - Toolset definitions
- `hermes_state.py` - SQLite session store with FTS5 search
- `tools/` - 744 Python files implementing various tools
- `gateway/` - Multi-platform messaging (Telegram, Discord, Slack, etc.)
- `agent/` - Agent internals (prompt building, compression, caching)

---

## Active Tasks

### Task #1: FreeBSD Compatibility Audit
**Status**: [x] Completed  
**Priority**: High  
**Assigned to**: Programming Assistant  
**Completed**: 2026-04-08  

**Description**: 
Perform comprehensive audit of codebase to identify Linux-specific dependencies and system calls that need FreeBSD equivalents.

**Deliverables**:
- [x] List of all `os.uname()` checks for "Linux" - Found 8 instances
- [x] Identify PTY-related code (won't work on FreeBSD) - Graceful fallback exists
- [x] Find Docker/singularity backend compatibility issues - Requires container runtime
- [x] Document missing FreeBSD ports/packages - Voice tools unavailable

**Results**:
- Audit report: `PLANS/freebsd-audit.md` (comprehensive 80+ line analysis)
- Fixed `_PLATFORM_MAP` in `tools/skills_tool.py` and `agent/skill_utils.py` to include FreeBSD
- Identified voice tools as non-functional on FreeBSD (ctranslate2 has no wheels)
- Documented clipboard support gap for FreeBSD - needs xclip/xsel implementation

---

### Task #2: Remove Docker Dependency for FreeBSD Compatibility  
**Status**: [ ] Not started  
**Priority**: Critical  
**Assigned to**: Programming Assistant  

**Description**:
Hermes Agent runs natively on the host system using `LocalEnvironment`. Docker is NOT required for normal operation - it's only used as an optional isolated execution backend. Since Docker has no official FreeBSD support and won't be added, we need to safely remove/disable all Docker-related code paths while ensuring native execution works perfectly.

**Background**:
- `tools/environments/local.py` (`LocalEnvironment`) already provides full terminal execution on the host
- You (waym0re) confirmed running Hermes on Linux without Docker enabled
- FreeBSD users should use native execution exclusively - no containerization needed

**Deliverables**:
1. **Audit all Docker usages** - Find every reference to `DockerEnvironment` and docker-related config
2. **Make Docker backend optional/failable** - When user selects "docker" but it's unavailable, gracefully fall back to "local" with warning
3. **Update setup wizard** - Remove Docker as an option on FreeBSD, default to local
4. **Update documentation** - Clarify that Hermes runs natively; Docker is Linux-only optional feature
5. **Test native execution** - Ensure `LocalEnvironment` works without any container dependencies

**Files to Modify**:
- `tools/terminal_tool.py:618-628` - Add fallback from docker→local when unavailable
- `hermes_cli/setup.py:1320-1400` - Skip Docker option on FreeBSD, default to local
- `hermes_cli/status.py:261-263` - Don't show Docker status on FreeBSD
- `README.md:26` - Update "Terminal backends" line to clarify native execution
- `pyproject.toml` - Remove `[modal]` and `[daytona]` extras if they depend on Docker

**Acceptance Criteria**:
- On FreeBSD, setup wizard never offers Docker as an option
- If config has `"terminal_backend": "docker"` on FreeBSD, it auto-falls back to local with warning
- All core functionality works with `LocalEnvironment` alone (no containers)
- Documentation clearly states: "Hermes runs natively; Docker is optional Linux-only isolation"

---

### Task #3: Setup Documentation Review  
**Status**: [ ] Not started  
**Priority**: Medium  
**Assigned to**: Programming Assistant  

**Description**:
Review `README.md` installation instructions and verify all FreeBSD package names are correct. Cross-reference with official FreeBSD ports collection.

**Checklist**:
- [ ] Verify `pkg install rust` is correct
- [ ] Verify `pkg install python311` availability  
- [ ] Check if `uv` has a FreeBSD port or needs cargo install
- [ ] Validate all optional dependencies have FreeBSD equivalents
- [ ] Update installation section to reflect Docker removal (Task #2)

---

### Task #4: Create FreeBSD-Specific Error Handling for Voice Tools
**Status**: [x] Completed  
**Priority**: High  
**Assigned to**: Programming Assistant  
**Completed**: 2026-04-08  

**Description**:
Add graceful degradation for features that don't work on FreeBSD (voice/STT/TTS) with clear user messaging. The audit identified `faster-whisper` as unavailable due to missing `ctranslate2` wheels.

**Changes Made**:
- Added `_IS_FREEBSD` platform detection in `hermes_cli/config.py:29`
- Created `print_platform_warnings()` function to warn about FreeBSD limitations:
  - Voice tools unavailable (faster-whisper has no FreeBSD wheels)
  - Clipboard support requires xclip/xsel installation
- Integrated warnings into CLI startup (`cli.py:524`) and gateway (`gateway/run.py:204`)

**Files Modified**:
- `hermes_cli/config.py` - Added `_IS_FREEBSD` flag and `print_platform_warnings()` function
- `cli.py` - Added call to `print_platform_warnings()` at startup
- `gateway/run.py` - Added call to `print_platform_warnings()` at gateway init

**Note**: PTY already has graceful fallback in `tools/process_registry.py` (falls back to pipe mode when ptyprocess unavailable)

---

## Completed Tasks

### Task #4: FreeBSD-Specific Error Handling (2026-04-08)
Added platform detection and user warnings for FreeBSD limitations. Voice tools and clipboard support now show helpful messages at startup.

### Task #1: FreeBSD Compatibility Audit (2026-04-08)
Comprehensive audit completed. See `PLANS/freebsd-audit.md` for full report. Key fixes applied to `_PLATFORM_MAP`.

---

## Blockers & Known Issues

1. **No FreeBSD Test Environment**: om3ga only has Arch Linux locally. Programming assistant may also lack FreeBSD access.
2. **Issues Disabled**: GitHub issues feature is disabled in this repo, forcing us to use file-based task tracking.
3. **Limited Token Scope**: Fine-grained token only has access to `autolycus-agent` repo, not all of waym0re's repos.

---

## Meeting Notes / Updates

### 2026-04-08: Initial Setup
- om3ga cloned repository and verified full read/write access
- Discovered GitHub issues are disabled - switched to file-based task tracking
- Created this coordination framework document
- Identified key team roles and communication protocol

---

## How to Use This Document

1. **Adding Tasks**: om3ga adds new tasks under "Active Tasks" section with clear description and deliverables
2. **Claiming Tasks**: Programming assistant changes `[ ]` to `[~]` when starting work
3. **Progress Updates**: Add sub-bullets or notes under task as work progresses
4. **Completion**: Change `[~]` to `[x]` and move to "Completed Tasks" section
5. **Blockers**: Add to "Blockers & Known Issues" if stuck

---

*Last updated: 2026-04-08 by om3ga (repo manager)*  
*Document maintained in PLANS/task-coordination.md for version control and team visibility*
