# home

`home` is a desktop-first personal command center for work, meetings, AI-assisted tasks,
automations, and agent sessions. The hosted core runs on Railway; the native desktop shell is
planned for a later phase.

## Foundation architecture

- `apps/web` — Next.js UI
- `apps/api` — standalone Hono API and Better Auth server
- `apps/worker` — pg-boss background worker
- `packages/api` — typed Hono routes
- `packages/auth` — Better Auth configuration
- `packages/db` — Drizzle schema and migrations
- `packages/ui` — shared UI primitives

## Local setup

1. Install Bun 1.3.14 or newer and PostgreSQL with the `vector` extension available.
2. Copy `.env.example` to `.env.local` and update the values.
3. Run `bun install`.
4. Run `bun run db:migrate`.
5. Run `bun run dev`.

The web app defaults to `http://localhost:3000`; the API defaults to
`http://localhost:3001`. Use `bun run typecheck`, `bun test`, and `bun run build` before
shipping changes.

See the approved product design in
[`docs/superpowers/specs/2026-07-19-home-desktop-app-design.md`](docs/superpowers/specs/2026-07-19-home-desktop-app-design.md).

## Railway

Create three services from this shared Bun monorepo and point each service's config-as-code path
at `/apps/web/railway.toml`, `/apps/api/railway.toml`, or `/apps/worker/railway.toml`. Attach one
PostgreSQL service and expose its `DATABASE_URL` to the API and worker. The API pre-deploy command
applies Drizzle migrations before new code starts.

For production auth, use sibling domains and set:

- `WEB_URL=https://app.example.com`
- `NEXT_PUBLIC_API_URL=https://api.example.com`
- `BETTER_AUTH_URL=https://api.example.com`
- `AUTH_COOKIE_DOMAIN=example.com`
- `BETTER_AUTH_SECRET` to a high-entropy value of at least 32 characters

Organization invitation records are supported in the foundation. Delivery email is intentionally
not configured until an email provider is selected.

## Conductor

The shared Conductor setup installs the frozen Bun lockfile and allocates adjacent web/API ports.
Run mode is intentionally nonconcurrent for now because all local workspaces point at the same
PostgreSQL database and pg-boss queue. It can switch to concurrent after setup provisions an
isolated database per workspace.
