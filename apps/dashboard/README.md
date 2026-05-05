# Hermes Agent — Web UI

Browser-based dashboard for managing Hermes Agent configuration, API keys, and monitoring active sessions.

## Stack

- **Vite** + **React 19** + **TypeScript**
- **Tailwind CSS v4** with custom dark theme
- **shadcn/ui**-style components (hand-rolled, no CLI dependency)

## Development

Install workspace dependencies from the repo root first:

```bash
npm install
```

Start the backend API server from the repo root:

```bash
hermes dashboard --tui --no-open
```

`--tui` exposes the in-browser Chat tab through `/api/pty`. Omit it if you only need the config/session dashboard.

In another terminal, start the Vite dev server:

```bash
cd apps/dashboard
npm run dev
```

The Vite dev server proxies `/api`, `/api/pty`, and `/dashboard-plugins` to `http://127.0.0.1:9119` (the FastAPI backend). It also fetches the backend's `index.html` on each dev page load so the ephemeral session token stays in sync.

If the `hermes` entry point is not installed, use:

```bash
python -m hermes_cli.main dashboard --tui --no-open
```

## Build

```bash
npm run build
```

This outputs to `../../hermes_cli/web_dist/`, which the FastAPI server serves as a static SPA. The built assets are included in the Python package via `pyproject.toml` package-data.

## Structure

```
src/
├── components/ui/   # Reusable UI primitives (Card, Badge, Button, Input, etc.)
├── lib/
│   ├── api.ts       # API client — typed fetch wrappers for all backend endpoints
│   └── utils.ts     # cn() helper for Tailwind class merging
├── pages/
│   ├── StatusPage   # Agent status, active/recent sessions
│   ├── ConfigPage   # Dynamic config editor (reads schema from backend)
│   └── EnvPage      # API key management with save/clear
├── App.tsx          # Main layout and navigation
├── main.tsx         # React entry point
└── index.css        # Tailwind imports and theme variables
```
