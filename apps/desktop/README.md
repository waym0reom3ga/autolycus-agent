# Hermes Desktop

Native Electron shell for Hermes. It packages the desktop renderer, a bundled Hermes source payload, and installer targets for macOS and Windows.

## Setup

Install workspace dependencies from the repo root so `apps/desktop`, `apps/dashboard`, and `apps/shared` stay linked:

```bash
npm install
```

For Python, you have two options:

**Option A — let the desktop provision it for you (recommended for first-time setup):** just run `npm run dev`. On first launch the desktop creates a venv at `HERMES_HOME/hermes-agent/venv` and runs `pip install -e .` against the resolved Hermes source automatically. Requires Python 3.11+ on `PATH`.

**Option B — share an existing CLI install:** if you already ran `scripts/install.ps1` / `scripts/install.sh`, that's the same layout the desktop uses. The desktop reuses your existing venv and editable install — no extra steps. See [Runtime Bootstrap](#runtime-bootstrap) below for details.

If you're hacking on Hermes from a clone outside `HERMES_HOME/hermes-agent`, point the desktop at it explicitly:

```bash
HERMES_DESKTOP_HERMES_ROOT=/path/to/your/clone npm run dev
```

## Development

```bash
cd apps/desktop
npm run dev
```

`npm run dev` starts Vite on `127.0.0.1:5174`, launches Electron, and lets Electron boot the Hermes dashboard backend on an open port in `9120-9199`. This path is for UI iteration and may still show Electron/dev identities in OS prompts.

Useful overrides:

```bash
HERMES_DESKTOP_HERMES_ROOT=/path/to/hermes-agent npm run dev
HERMES_DESKTOP_PYTHON=/path/to/python npm run dev
HERMES_DESKTOP_CWD=/path/to/project npm run dev
HERMES_DESKTOP_IGNORE_EXISTING=1 npm run dev
HERMES_HOME=/tmp/throwaway-hermes-home npm run dev
HERMES_DESKTOP_BOOT_FAKE=1 npm run dev
HERMES_DESKTOP_BOOT_FAKE=1 HERMES_DESKTOP_BOOT_FAKE_STEP_MS=900 npm run dev
```

`HERMES_DESKTOP_IGNORE_EXISTING=1` skips any `hermes` CLI already on `PATH`, which is useful when testing the factory-image bootstrap path.

`HERMES_HOME` overrides the install root (default: `%LOCALAPPDATA%\hermes` on Windows, `~/.hermes` elsewhere) — handy for sandboxed dev runs that shouldn't touch your real config.

`HERMES_DESKTOP_BOOT_FAKE=1` adds deterministic per-phase delays to desktop startup so you can validate the startup overlay and progress bar. For convenience, `npm run dev:fake-boot` enables fake mode with defaults.

On a fresh Hermes profile, Desktop shows a first-run setup overlay after boot. The overlay saves the minimum required provider credential (for example `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`) to the active Hermes `.env`, reloads the backend env, and then lets the user continue without opening Settings manually.

## Dashboard Dev

Run the Python dashboard backend with embedded chat enabled:

```bash
hermes dashboard --tui --no-open
```

For dashboard HMR, start Vite in another terminal:

```bash
cd apps/dashboard
npm run dev
```

Open the Vite URL. The dev server proxies `/api`, `/api/pty`, and plugin assets to `http://127.0.0.1:9119` and fetches the live dashboard HTML so the ephemeral session token matches the running backend.

## Build

```bash
npm run build
npm run pack          # unpacked app at release/mac-<arch>/Hermes.app
npm run dist:mac      # macOS DMG + zip
npm run dist:mac:dmg  # DMG only
npm run dist:mac:zip  # zip only
npm run dist:win      # NSIS + MSI
```

Before packaging, `stage:hermes` copies the Python Hermes payload into `build/hermes-agent`. Electron Builder then ships it as `Contents/Resources/hermes-agent`.

## Automated Releases

Desktop installers are published by [`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml) with two channels:

- **Stable:** runs on published GitHub releases and uploads signed artifacts to that release tag.
- **Nightly:** runs on `main` pushes and updates the rolling `desktop-nightly` prerelease.

The workflow injects a channel-aware desktop version at build time:

- stable: derived from the release tag (for example `v2026.5.5` -> `2026.5.5`)
- nightly: `0.0.0-nightly.YYYYMMDD.<sha>`

Artifact names include channel, platform, and architecture:

```text
Hermes-<version>-<channel>-<platform>-<arch>.<ext>
```

Each run also publishes `SHA256SUMS-<platform>.txt` so installers can be verified.

### Stable release gates

Stable builds fail fast if signing credentials are missing:

- macOS signing + notarization: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
- Windows signing: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

Stable macOS builds also validate stapling and Gatekeeper assessment in CI before upload.

## Icons

Desktop icons live in `assets/`:

- `assets/icon.icns`
- `assets/icon.ico`
- `assets/icon.png`

The builder config points at `assets/icon`. Replace these files directly if the app icon changes.

## Testing Install Paths

Use the package-local test scripts from this directory:

```bash
npm run test:desktop:all
npm run test:desktop:existing
npm run test:desktop:fresh
npm run test:desktop:dmg
npm run test:desktop:platforms
```

`test:desktop:existing` builds the packaged app and opens it normally. It should use an existing `hermes` CLI if one is on `PATH`, preserving the user’s real `~/.hermes` config.

`test:desktop:fresh` builds the packaged app and launches it in a throwaway fresh-install sandbox. It sets `HERMES_DESKTOP_IGNORE_EXISTING=1`, points Electron `userData` at a temp dir, points `HERMES_HOME` at a temp dir, and launches through the factory-image bootstrap path without touching your real desktop runtime or `~/.hermes`.

`test:desktop:dmg` builds and opens the DMG.

`test:desktop:platforms` runs platform bootstrap-path assertions, including:
- existing-CLI vs factory-image runtime path selection semantics
- WSL2 protection against Windows `.exe/.cmd/.bat/.ps1` overrides
- platform-specific runtime import checks (`winpty` vs `ptyprocess`)

For fast reruns without rebuilding:

```bash
HERMES_DESKTOP_SKIP_BUILD=1 npm run test:desktop:fresh
HERMES_DESKTOP_SKIP_BUILD=1 npm run test:desktop:existing
HERMES_DESKTOP_SKIP_BUILD=1 npm run test:desktop:dmg
```

## Installing Locally

```bash
npm run dist:mac:dmg
open release/Hermes-0.0.0-arm64.dmg
```

Drag `Hermes` to Applications. If testing repeated installs, replace the existing app.

## Runtime Bootstrap

Hermes Desktop shares its install layout with the CLI installers (`scripts/install.ps1`, `scripts/install.sh`) so a desktop-only user and a CLI-only user end up with the same files in the same places.

### Where things live

```text
HERMES_HOME/                       # %LOCALAPPDATA%\hermes (Windows)
                                   # ~/.hermes (macOS / Linux)
├── hermes-agent/                  # ACTIVE_HERMES_ROOT — the canonical install
│   ├── hermes_cli/, agent/, ...   # Python source
│   ├── pyproject.toml             # source of truth for deps
│   ├── venv/                      # virtualenv (Scripts\python.exe on Windows,
│   │                              #             bin/python elsewhere)
│   └── .hermes-desktop-runtime.json   # marker: schema version + pyproject hash
├── config.yaml                    # user config
├── .env                           # API keys
└── logs/
    ├── desktop.log                # Electron-side boot log
    ├── agent.log
    ├── errors.log
    └── gateway.log
```

The factory image (`Contents/Resources/hermes-agent` on macOS, `resources\hermes-agent` on Windows) ships inside the `.app` / `.exe` and seeds `HERMES_HOME/hermes-agent` on first launch.

### Resolution order

The desktop resolves a Hermes backend in this order:

1. `HERMES_DESKTOP_HERMES_ROOT` — explicit dev override.
2. Existing `hermes` CLI on PATH (skipped when `HERMES_DESKTOP_IGNORE_EXISTING=1`).
3. Repo source root — only when running `npm run dev` from a checkout. Takes precedence over `HERMES_HOME/hermes-agent` so devs always run their local edits.
4. `HERMES_HOME/hermes-agent` if it already exists (CLI installer or prior desktop launch).
5. Packaged + factory image present → sync factory → `HERMES_HOME/hermes-agent`, then use it.
6. Pip-installed `hermes_cli` module via system Python.

### First-launch flow on a packaged install

1. Sync factory image → `HERMES_HOME/hermes-agent`. Skipped if a `.git` directory exists at the destination (developer install) — never overwrites a user's local repo.
2. Create venv at `HERMES_HOME/hermes-agent/venv` using system Python (errors out with a Python-install hint if no Python 3.11+ is found).
3. `pip install -e HERMES_HOME/hermes-agent` — `pyproject.toml` is the single source of truth for dependencies.
4. Stamp `.hermes-desktop-runtime.json` with the schema version + pyproject hash + factory version.

Subsequent launches compare the marker against the active `pyproject.toml` and skip steps 2-4 when nothing has changed.

### Upgrades

A new installer drops a new factory image. On next launch the marker mismatches → factory contents are copied over `HERMES_HOME/hermes-agent` (excluding `venv/`, `.git`, `__pycache__`, etc.), `pip install -e` re-runs to pick up new deps, the marker is re-stamped. The venv is preserved across upgrades to keep the upgrade fast when deps haven't moved.

A user who installed via `scripts/install.ps1` / `scripts/install.sh` (so `HERMES_HOME/hermes-agent/.git` exists) is detected as a developer install and the desktop never overwrites their checkout — they keep using `hermes update` / `git pull` to update.

## Debugging

Desktop boot logs are written to:

```text
HERMES_HOME/logs/desktop.log     # %LOCALAPPDATA%\hermes\logs\desktop.log on Windows
                                  # ~/.hermes/logs/desktop.log on macOS / Linux
```

If the UI reports `Desktop boot failed`, check that log first. It includes the backend command output and recent Python traceback context.

To reset desktop runtime state (forces re-sync from the factory image and re-`pip install -e .` on next launch):

```bash
# macOS / Linux
rm "$HOME/.hermes/hermes-agent/.hermes-desktop-runtime.json"

# Windows (PowerShell)
Remove-Item "$env:LOCALAPPDATA\hermes\hermes-agent\.hermes-desktop-runtime.json"
```

For a full reset of just the Python venv (rare — usually only needed if the venv is broken):

```bash
# macOS / Linux
rm -rf "$HOME/.hermes/hermes-agent/venv"

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\hermes\hermes-agent\venv"
```

To reset stale macOS microphone permission prompts:

```bash
tccutil reset Microphone com.github.Electron
tccutil reset Microphone com.nousresearch.hermes
```

## Verification

Run before handing off installer changes:

```bash
npm run fix
npm run type-check
npm run lint
npm run test:desktop:all
```

Current lint may report existing warnings, but it should exit with no errors.
