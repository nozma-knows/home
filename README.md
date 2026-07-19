# home

`home` is a desktop-first personal command center for connected work, AI-assisted tasks,
briefings, automations, and local coding sessions. The hosted core runs on Railway at
[`home.milbo.co`](https://home.milbo.co); the native macOS shell wraps the same web app and adds
a tray, notifications, push-to-talk, and a permission-gated local coding sidecar.

## What is included

- Google OAuth and passwordless six-digit email sign-in through Resend
- Gmail, Slack, and Linear OAuth connections, background sync, unified triage, and source actions
- Hosted OpenAI, Anthropic, and Google agent sessions with model switching, tool transcripts,
  plans, memory distillation, encrypted API keys, and usage tracking
- Scheduled morning briefings, RSS feeds, news topics, and optional Tavily search
- Natural-language automations, manual/scheduled/event triggers, tiered autonomy, approvals,
  suggestions, an audit trail, skills/slash commands, and an MCP registry
- Installable PWA plus a Tauri 2 macOS app with tray behavior, native notifications, Option-Space
  dictation, and local repository sessions with mobile-friendly permission approval

## Architecture

- `apps/web` — Next.js web app and PWA
- `apps/api` — Hono API, Better Auth, OAuth callbacks, and sidecar WebSockets
- `apps/worker` — pg-boss workers for sync, agents, briefings, memory, and automations
- `apps/desktop` — Tauri 2 native shell
- `apps/sidecar` — compiled Bun process for local coding sessions
- `packages/api` — typed Hono routes shared with the web client
- `packages/auth`, `packages/connectors`, `packages/ai`, `packages/agent`, `packages/core` — domain
  packages
- `packages/db` — Drizzle schema and migrations over Railway Postgres/pgvector

## Local development

Requirements: Bun 1.3.14+, PostgreSQL with the `vector` extension, and Rust when building the
desktop app.

```sh
cp .env.example .env.local
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

The web app defaults to `http://localhost:3000` and the API to `http://localhost:3001`.

Quality gate:

```sh
bun run check
bun test
bun run build
```

Native macOS app:

```sh
bun run --cwd apps/desktop build
```

The build compiles the sidecar automatically and produces
`apps/desktop/src-tauri/target/release/bundle/macos/home.app`. Local natural-language coding
requests use the installed `codex` CLI; exact commands can be sent with a `$ ` prefix. Plan mode
is read-only, Ask requests approval before mutating commands, and Auto permits them within the
bound repository.

## Production

Production uses sibling domains:

- Web: `https://home.milbo.co`
- API, auth callbacks, and WebSockets: `https://home-api.milbo.co`

The Railway services use `apps/web/railway.toml`, `apps/api/railway.toml`, and
`apps/worker/railway.toml`. The API applies Drizzle migrations before starting. Keep
`CREDENTIAL_ENCRYPTION_KEY` identical on API and worker; do not rotate it without re-encrypting
stored connector and AI credentials.

Complete provider callbacks, environment variables, deployment checks, and troubleshooting are
documented in [`docs/operations.md`](docs/operations.md).

The approved product design and intentionally deferred items live in
[`docs/superpowers/specs/2026-07-19-home-desktop-app-design.md`](docs/superpowers/specs/2026-07-19-home-desktop-app-design.md).

## Conductor

The shared Conductor setup installs the frozen Bun lockfile and allocates adjacent web/API ports.
Run mode is nonconcurrent because workspaces currently share one local database and pg-boss queue.
