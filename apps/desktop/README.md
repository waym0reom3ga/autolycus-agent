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
```

`HERMES_DESKTOP_IGNORE_EXISTING=1` skips any `hermes` CLI already on `PATH`, which is useful when testing the bundled/runtime bootstrap path.

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
```

`test:desktop:existing` builds the packaged app and opens it normally. It should use an existing `hermes` CLI if one is on `PATH`, preserving the user’s real `~/.hermes` config.

`test:desktop:fresh` builds the packaged app, deletes the bundled desktop runtime, sets `HERMES_DESKTOP_IGNORE_EXISTING=1`, and launches the app through the bundled payload path. Use this repeatedly to test first-run bootstrap.

`test:desktop:dmg` builds and opens the DMG.

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
