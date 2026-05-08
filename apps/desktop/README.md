# Hermes Desktop

Native Electron shell for Hermes. It packages the desktop renderer, a bundled Hermes source payload, and installer targets for macOS and Windows.

## Setup

Install workspace dependencies from the repo root so `apps/desktop`, `apps/dashboard`, and `apps/shared` stay linked:

```bash
npm install
```

Use the normal Hermes Python environment for local runs:

```bash
source .venv/bin/activate  # or: source venv/bin/activate
python -m pip install -e .
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
HERMES_DESKTOP_BOOT_FAKE=1 npm run dev
HERMES_DESKTOP_BOOT_FAKE=1 HERMES_DESKTOP_BOOT_FAKE_STEP_MS=900 npm run dev
```

`HERMES_DESKTOP_IGNORE_EXISTING=1` skips any `hermes` CLI already on `PATH`, which is useful when testing the bundled/runtime bootstrap path.

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

`test:desktop:fresh` builds the packaged app and launches it in a throwaway fresh-install sandbox. It sets `HERMES_DESKTOP_IGNORE_EXISTING=1`, points Electron `userData` at a temp dir, points `HERMES_HOME` at a temp dir, and launches through the bundled payload path without touching your real desktop runtime or `~/.hermes`.

`test:desktop:dmg` builds and opens the DMG.

`test:desktop:platforms` runs platform bootstrap-path assertions, including:
- existing vs bundled runtime path selection semantics
- WSL2 protection against Windows `.exe/.cmd/.bat/.ps1` overrides
- platform-specific bundled runtime import checks (`winpty` vs `ptyprocess`)

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

Packaged desktop startup resolves Hermes in this order:

1. `HERMES_DESKTOP_HERMES_ROOT`
2. existing `hermes` CLI, unless `HERMES_DESKTOP_IGNORE_EXISTING=1`
3. bundled `Contents/Resources/hermes-agent`
4. dev repo source
5. installed `python -m hermes_cli.main`

When the bundled path is used, Electron creates or reuses:

```text
~/Library/Application Support/Hermes/hermes-runtime
```

The runtime is validated before use. If required dashboard imports are missing, it reinstalls the desktop runtime dependencies and retries.

## Debugging

Desktop boot logs are written to:

```text
~/Library/Application Support/Hermes/desktop.log
```

If the UI reports `Desktop boot failed`, check that log first. It includes the backend command output and recent Python traceback context.

To reset bundled runtime state:

```bash
rm -rf "$HOME/Library/Application Support/Hermes/hermes-runtime"
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
