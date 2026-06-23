# Autolycus Codebase Overview

Generated: 2026-06-22 | Branch: main @ f801a2d74 | Tag: v0.2.0

## Executive Summary

Autolycus is a multi-platform AI agent system with ~350K+ lines of Python, ~400K+ lines of TypeScript/JS (web + desktop), and ~572K lines of tests. The architecture follows a modular plugin pattern with clear ABCs for extension points, but suffers from several "god files" that exceed 10K+ lines each despite active decomposition campaigns.

**Total estimated LOC by area:**
- Python source: ~350K (gateway: 60K, agent: 75K, lycus_cli: 136K, cron: 3K, tools: 80K, plugins: 17K)
- TypeScript/JS: ~400K (web: 98 files, desktop: 300+ files)
- Tests: ~572K (1,559 Python test files + 118 TS tests in desktop)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERFACES                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ CLI      │  │ Web SPA  │  │ Desktop  │                 │
│  │ (lycus)  │  │ (React)  │  │(Electron)│                 │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                 │
│       │              │             │                        │
├───────┼──────────────┼─────────────┼────────────────────────┤
│       ▼              ▼             ▼                        │
│  ┌──────────────────────────────────────┐                  │
│  │           GATEWAY LAYER              │                  │
│  │  Multi-platform messaging hub        │                  │
│  │  (Telegram, Discord, Slack, etc.)    │                  │
│  └──────────────┬───────────────────────┘                  │
│                 ▼                                           │
│  ┌──────────────────────────────────────┐                  │
│  │           AGENT CORE                 │                  │
│  │  Conversation loop, tool execution,  │                  │
│  │  context compression, provider API   │                  │
│  └──────────────┬───────────────────────┘                  │
│                 ▼                                           │
│  ┌──────────────────────────────────────┐                  │
│  │           TOOLS LAYER                │                  │
│  │  73 registered tools (terminal,      │                  │
│  │  browser, file ops, MCP, etc.)       │                  │
│  └──────────────┬───────────────────────┘                  │
│                 ▼                                           │
│  ┌──────────────────────────────────────┐                  │
│  │           CRON SCHEDULER             │                  │
│  │  Scheduled jobs, delivery routing    │                  │
│  └──────────────────────────────────────┘                  │
│                                                             │
│  ┌──────────────────────────────────────┐                  │
│  │         PLUGIN SYSTEM                │                  │
│  │  Model providers, platforms, memory, │                  │
│  │  image/video gen, web search, etc.   │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Per-Directory Breakdown

### 1. Gateway (`gateway/`) — Multi-Platform Messaging Hub

**Size:** ~60K lines across 30+ files | **Tests:** 319 test files

**Purpose:** Connects the AI agent to 20+ messaging platforms through a unified interface. Handles session management, message routing, streaming delivery, slash commands (~42), and user authorization.

**Key Files:**
- `run.py` — **16,874 lines** (GOD FILE) — GatewayRunner orchestrator class
- `platforms/base.py` — 4,933 lines — Abstract base for all platform adapters
- `slash_commands.py` — 3,875 lines — Extracted mixin for command handlers
- `config.py` — 2,139 lines — Configuration loading/validation

**Strengths:**
- Clean ABC pattern (`BasePlatformAdapter`) with plugin registration system
- Active god-file decomposition campaign (mixins extracted from run.py)
- Lazy imports optimize startup cost
- PII redaction in session storage (SHA-256 hashing)
- Comprehensive docstrings throughout

**Weaknesses:**
- `run.py` at 16,874 lines is the single largest technical debt item
- Mixin inheritance chain fragility — harder to trace than composition would be
- Platform-specific regex patterns scattered in run.py instead of adapters
- Platform adapter quality varies wildly (Telegram: 6,797 vs SMS: 379)

**Recommendation:** Continue decomposing `run.py` into focused modules. Target extractions: message processing pipeline, agent cache management, streaming coordination. Consider composition over mixins for future work.

---

### 2. Agent Core (`agent/`) — AI Engine

**Size:** ~75K lines across 118 files | **Tests:** ~80 test files in tests/agent/

**Purpose:** Core AI agent engine extracted from monolithic `run_agent.py` (5,433 lines). Handles conversation loops, tool execution, context compression, provider adapters, and credential management.

**Key Files:**
- `conversation_loop.py` — 4,685 lines — Main turn loop (model call → tool dispatch → retries)
- `auxiliary_client.py` — **6,082 lines** (GOD FILE) — Shared LLM client router with multi-provider fallback
- `agent_init.py` — 1,730 lines — Extracted AIAgent.__init__ body
- `prompt_builder.py` — 1,722 lines — System prompt assembly

**Strengths:**
- Clean extraction pattern from monolithic run_agent.AIAgent into focused modules
- Well-designed ABCs: ProviderTransport (89 lines), ContextEngine, MemoryProvider
- Lazy import discipline reduces cold-start latency by ~200-240ms per SDK
- Sophisticated provider fallback chains with automatic 402/credit-exhaustion failover
- Security-conscious: context file injection scanning, tool guardrails

**Weaknesses:**
- `auxiliary_client.py` at 6,082 lines still violates "refactor god-files" principle
- Pervasive `_ra()` anti-pattern — 6 modules use lazy back-references to run_agent
- `agent_runtime_helpers.py` (2,606 lines) is a grab-bag of unrelated functions
- No public API surface defined in __init__.py

**Recommendation:** Split `auxiliary_client.py` into: provider resolution chain, client construction, streaming handler, retry/failover logic. Eliminate `_ra()` back-references by completing the extraction so run_agent depends on agent/ modules, not vice versa.

---

### 3. CLI (`lycus_cli/`) — Command-Line Interface

**Size:** ~136K lines across 175 files | **Tests:** ~200 test files in tests/lycus_cli/

**Purpose:** Full-featured CLI with subcommands for gateway management, config, profiles, kanban boards, model selection, and dashboard serving.

**Key Files:**
- `main.py` — **12,534 lines** (GOD FILE) — Central dispatch hub with 60+ cmd_* handlers
- `web_server.py` — **12,091 lines** (GOD FILE) — FastAPI dashboard server
- `auth.py` — 8,166 lines — OAuth flows, credential pools, JWT handling
- `kanban_db.py` — 7,750 lines — SQLite kanban board persistence
- `gateway.py` — 7,048 lines — Gateway process lifecycle (systemd/launchd)

**Strengths:**
- Subcommand parser extraction into `subcommands/` package (40 thin modules)
- Active "Phase 2" refactoring plan documented in docstrings
- Platform abstraction for gateway management (Linux/macOS/Windows)
- Dashboard auth plugin framework with proper provider registry
- Defensive startup with graceful degradation

**Weaknesses:**
- Top 6 files account for ~54K lines (40% of entire package)
- Flat top-level namespace — ~168 modules live directly under lycus_cli/
- Handler functions still in main.py despite extraction plan
- Mixed concerns in web_server.py (REST, WebSocket, file mgmt, themes, plugins)

**Recommendation:** Extract `cmd_*` handlers from main.py into a `handlers/` subpackage. Split web_server.py into route modules: routes/api.py, routes/ws.py, routes/files.py, etc. Group flat modules into logical subpackages (auth/, model/, session/).

---

### 4. Cron Scheduler (`cron/`) — Scheduled Task Execution

**Size:** ~3K lines across 7 files | **Tests:** ~15 test files in tests/cron/

**Purpose:** Full-featured scheduled task system with cron expressions, intervals, one-shot schedules, and multi-platform delivery to messaging channels.

**Key Files:**
- `scheduler.py` — 2,309 lines (GOD FILE) — Tick loop, job execution, delivery routing
- `jobs.py` — 1,321 lines — Job CRUD, JSON storage, schedule parsing
- `blueprint_catalog.py` — 713 lines — Parameterized automation blueprints

**Strengths:**
- Excellent defensive coding: path traversal guards, immutable fields, JSON auto-repair
- Robust concurrency model: cross-process file locks, thread pools, at-most-once semantics
- Well-documented with GitHub issue references for traceability
- Clean separation of storage (jobs.py) from execution (scheduler.py)
- Security-conscious: prompt injection scanning, platform allowlisting

**Weaknesses:**
- `scheduler.py` bundles tick orchestration, job execution, delivery routing (~200 lines), media handling, and MCP orphan cleanup
- Delivery logic tightly coupled to gateway internals
- Blueprint catalog duplicates entries from suggestion_catalog.py
- `sys.path.insert(0, ...)` hack masks import path issues

**Recommendation:** Extract delivery logic into `cron/delivery.py` (cuts scheduler by ~20%). Consolidate blueprint and suggestion catalogs. Fix circular imports with proper package structure.

---

### 5. Tools (`tools/`) — Agent Tool Implementations

**Size:** ~80K lines across 105 files | **Tests:** 1 test file (CRITICAL GAP)

**Purpose:** 73 registered tools covering terminal, browser, file operations, MCP client, skills system, media generation, security/policy, and integrations.

**Key Files:**
- `registry.py` — 589 lines — Central singleton with thread-safe snapshots + TTL caching
- `lazy_deps.py` — 648 lines — Runtime dependency installer with allowlist security model
- `mcp_tool.py` — **4,156 lines** (GOD FILE) — MCP client implementation
- `browser_tool.py` — 3,891 lines — Browser automation
- `skills_hub.py` — 3,888 lines — Skills system hub

**Strengths:**
- Self-registering plugin pattern with AST-based auto-discovery
- Elegant lazy dependency management with venv scoping and offline detection
- Registry TTL caching on check_fn (30s) amortizes expensive environment probes
- Thread-safety throughout: RLock, contextvars.ContextVar, thread-local state

**Weaknesses:**
- **Near-zero test coverage** — only 1 test file for 80K lines of code
- Flat directory with 105 files — no logical subdirectories
- Massive single-file modules (top 5 = ~18K lines, 23% of total)
- Duplicate responsibilities: `file_tools.py` and `file_operations.py` overlap

**Recommendation:** Split big files into focused submodules. Add directory structure (browser/, skills/, media/, integrations/). Write integration tests for tool registration/deregistration and dispatch error handling. Consolidate overlapping file tools.

---

### 6. Web & Desktop (`web/`, `apps/desktop/`) — User Interfaces

**Size:** ~400K lines combined | **Tests:** web: 0 (CRITICAL GAP) | desktop: 118 test files

**Purpose:** React 19 SPAs built with Vite + TypeScript + Tailwind v4. Web app is a browser dashboard served by Python backend; Desktop is an Electron shell connecting directly to the gateway.

**Key Files:**
- `electron/main.cjs` — **6,575 lines** (GOD FILE) — Electron main process
- `web/src/lib/api.ts` — 2,213 lines — Monolithic API client
- `web/src/App.tsx` — 1,265 lines — App root with routing and layout

**Strengths:**
- Desktop has excellent modular decomposition: store/, lib/, components/ui/
- NanoStores pattern in desktop is clean — fine-grained reactive stores
- Plugin system in web/ with manifest-driven nav injection
- Both share @nous-research/ui component library

**Weaknesses:**
- `electron/main.cjs` at 6,575 lines handles window management, IPC (~20+ channels), OAuth, updates, hardening
- **Web has ZERO tests** — entire dashboard SPA is untested
- @nous-research/ui version mismatch (web: 0.18.2, desktop: ^0.13.0)

**Recommendation:** Split electron/main.cjs into focused modules (windows.cjs, ipc-handlers.cjs, bootstrap.cjs). Add tests to web/ starting with lib/api.ts. Align @nous-research/ui versions between web and desktop.

---

### 7. Plugins (`plugins/`) — Extension System

**Size:** ~17K lines across 137 files | **Tests:** Only lycus-achievements/tests/

**Purpose:** 18 plugin categories covering model providers (25), messaging platforms (10), web search (7), browser backends (3), image/video generation, memory backends (8), dashboard auth (3), and more.

**Key Files:**
- `plugin_utils.py` — 135 lines — Thread-safe singleton primitives with test reset
- Discord adapter — **6,801 lines** (GOD FILE) — Largest plugin file

**Strengths:**
- Consistent ABC-driven design across all categories
- Excellent documentation explaining not just what but why
- Fail-open philosophy: graceful degradation when deps/credentials missing
- Thread safety awareness in plugin_utils.py
- Security-conscious with warn-vs-block design

**Weaknesses:**
- Discord adapter at 6,801 lines is the single largest plugin file
- `sys.path.insert` hack bypasses proper package structure
- Honcho memory provider complexity (1,419 lines) with many internal state variables
- No shared test infrastructure visible

**Recommendation:** Extract Discord adapter into focused modules. Standardize imports to eliminate sys.path hacks. Add plugin test harness that mocks the ctx registration interface. Externalize achievement definitions to JSON.

---

### 8. Tests (`tests/`) — Test Suite

**Size:** ~572K lines across 1,559 Python files + 118 TS tests | **Framework:** pytest 9.0.2 + pytest-asyncio

**Purpose:** Comprehensive test suite mirroring the source tree with domain-specific subdirectories.

**Strengths:**
- Exceptional hermetic environment: strips 100+ credential env vars per test
- Live-system guard prevents tests from murdering developer's gateway process
- Per-file process spawning prevents cross-file state leakage
- Anti-pattern guards actively scan test ASTs to prevent plugin adapter anti-patterns
- Well-documented rationale with GitHub issue references

**Weaknesses:**
- Massive individual files: `test_tui_gateway_server.py` (7,696), `test_run_agent.py` (6,619)
- Duplicate isolation fixtures across test files
- Stress tests not integrated in CI (opt-in only)
- No coverage reporting configuration visible

**Recommendation:** Split largest test files into feature-scoped sub-files. Consolidate duplicate fixtures into shared conftest modules per domain. Add coverage thresholds in CI.

---

## Cross-Cutting Patterns

### Strengths (What Works Well)

1. **ABC-driven extension model**: Clean abstract base classes for platform adapters, provider transports, memory backends, web search providers, etc. Adding new implementations is mechanical and safe.

2. **Lazy import discipline**: Heavy SDK imports deferred to first-call time via sentinel patterns. Reduces cold-start latency significantly.

3. **Security-conscious design**: PII redaction, credential sanitization, prompt injection scanning, path traversal guards, secret pattern matching throughout.

4. **Comprehensive documentation**: Nearly every module has detailed docstrings explaining purpose, architecture decisions, and lifecycle contracts.

5. **Plugin registration system**: Self-registering tools with AST-based auto-discovery, TTL-cached availability checks, and thread-safe snapshots.

6. **Test infrastructure quality**: Hermetic environment strategy is best-in-class — credential stripping, live-system guard, per-file process isolation.

### Weaknesses (What Needs Work)

1. **God files everywhere**: Despite active decomposition campaigns, the codebase has multiple files exceeding 10K+ lines:
   - `gateway/run.py`: 16,874 lines
   - `lycus_cli/main.py`: 12,534 lines
   - `lycus_cli/web_server.py`: 12,091 lines
   - `plugins/discord/adapter.py`: 6,801 lines
   - `electron/main.cjs`: 6,575 lines
   - `agent/auxiliary_client.py`: 6,082 lines

2. **Test coverage gaps**: 
   - tools/: 1 test for 80K LOC (CRITICAL)
   - web/: 0 tests for entire SPA (CRITICAL)
   - plugins/: Only lycus-achievements has tests

3. **Flat directory structures**: lycus_cli/ (168 modules flat), tools/ (105 files flat). Makes navigation and refactoring harder.

4. **Import hygiene issues**: `sys.path.insert` hacks, `_ra()` back-references, circular import workarounds via lazy imports.

---

## Technical Debt Inventory

| Priority | File | Lines | Issue | Impact |
|----------|------|-------|-------|--------|
| P0 | gateway/run.py | 16,874 | God file despite active decomposition | Hard to maintain, review, test |
| P0 | lycus_cli/main.py | 12,534 | Central hub with 60+ cmd_* handlers | Tight coupling, import explosion |
| P0 | lycus_cli/web_server.py | 12,091 | Mixed REST/WS/file/theme/plugin concerns | Hard to reason about routes |
| P1 | plugins/discord/adapter.py | 6,801 | Voice + commands + auth in one file | Single point of failure for Discord |
| P1 | electron/main.cjs | 6,575 | Window + IPC + OAuth + updates monolith | Desktop maintenance burden |
| P1 | agent/auxiliary_client.py | 6,082 | Provider resolution + streaming + retry | Violates own decomposition principle |
| P1 | tools/mcp_tool.py | 4,156 | Full MCP client in one file | Hard to test individual features |
| P2 | cron/scheduler.py | 2,309 | Tick + execution + delivery bundled | Delivery logic should be separate |

---

## Recommendations (Prioritized)

### Immediate (High Impact / Low Risk)

1. **Add tests for tools/ directory** — Start with tool registration/deregistration and dispatch error handling. This is the highest-risk area with zero coverage.

2. **Add tests for web/ dashboard** — Focus on lib/api.ts auth flow, session rotation, and profile scoping logic.

3. **Split electron/main.cjs** into focused modules: windows.cjs, ipc-handlers.cjs, bootstrap.cjs, updates.cjs, auth.cjs. The file already imports from modular .cjs files in the same directory — just move inline handlers out.

4. **Extract delivery logic from cron/scheduler.py** into cron/delivery.py (~500 lines). Cuts scheduler by ~20%.

### Short-term (Medium Impact / Medium Risk)

5. **Continue gateway/run.py decomposition** — Target extractions: message processing pipeline, agent cache management, streaming coordination. Move platform-specific regex patterns to their adapters.

6. **Split agent/auxiliary_client.py** into: provider resolution chain, client construction, streaming handler, retry/failover logic.

7. **Extract cmd_* handlers from lycus_cli/main.py** into a handlers/ subpackage. Each handler becomes its own module.

8. **Group flat directories into logical subpackages**: tools/browser/, tools/skills/, tools/media/, tools/integrations/. lycus_cli/auth/, lycus_cli/model/, lycus_cli/session/.

### Medium-term (Strategic)

9. **Eliminate _ra() back-references** in agent/ — Complete the extraction so run_agent depends on agent/ modules, not vice versa.

10. **Fix import hygiene** — Replace sys.path.insert hacks with proper package structure or shared import helpers.

11. **Align @nous-research/ui versions** between web (0.18.2) and desktop (^0.13.0).

12. **Add coverage thresholds in CI** to catch untested code paths as the suite grows.

### Long-term (Architectural)

13. **Consider composition over mixins** for future gateway extractions — inject services rather than inheriting them.

14. **Define public API surfaces** with __all__ exports or dedicated API modules in agent/, tools/, and lycus_cli/.

15. **Document ABC contracts** — A single reference doc listing all provider ABCs with method signatures would lower the barrier for new plugin authors.

---

## Summary

Autolycus is a well-architected system at the module level with clear boundaries, clean extension interfaces, and excellent documentation. The primary technical debt is concentrated in god files that exceed 10K+ lines despite active decomposition campaigns. Test coverage gaps in tools/ (80K LOC, 1 test) and web/ (entire SPA, 0 tests) represent critical risk areas.

The codebase shows architectural awareness — extraction plans are documented, ABCs are well-designed, and the plugin system is extensible. The main challenge is execution: completing the decomposition campaigns that have already begun while filling coverage gaps in high-risk areas.
