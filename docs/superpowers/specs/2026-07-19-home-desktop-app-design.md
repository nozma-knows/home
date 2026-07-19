# home — Design Document

**Date:** 2026-07-19
**Status:** Approved pending final review

## What is home?

A personal command center: a desktop-first app that connects your LLM accounts and work tools (Slack, Gmail, Linear, and a growing list) so you can track work, meetings, and schedule in one place, complete work with AI assistance, and set up automations and suggestions — with a memory layer that learns about you over time.

Multi-user by design (every row scoped to a user), with organization support: users belong to organizations through a `user_organizations` membership table. Built first for a single power user.

## Users & organizations

- **Auth:** BetterAuth with its **organization plugin** — provides `organizations`, `user_organizations` (membership with roles: `owner` | `admin` | `member`), and invitation flows out of the box.
- **Scoping rules — what belongs to whom:**
  - **Always user-scoped (personal):** Gmail/personal connections, memories, chat conversations, provider accounts (LLM keys), briefings, triage state. An org admin never sees a member's inbox or memories.
  - **Org-scopable (optional `organizationId` alongside `userId`):** connections that are naturally shared (a Slack workspace, a Linear team), automations, and RSS feeds/news topics. A row with `organizationId` set is visible to org members per their role; without it, it's personal.
  - Every table carries `userId` (the owner/actor); org-scopable tables add nullable `organizationId`. Query helpers in `packages/db` take a `scope` argument (`{ userId }` or `{ userId, organizationId }`) so access control stays structural.
- **Day-one behavior:** everything defaults to personal scope. Org sharing of connections/automations is wired into the schema from the start (so no migration later) but its UI arrives with the Automations phase.

## Product surfaces (day one)

1. **Morning briefing** — the home screen. Generated on your schedule (default 7am, per-user timezone): today's meetings, top priorities with reasoning, things waiting on you, things you're blocking, pending approvals, and a capped **News** section (RSS feeds + web-search topics, filtered by your interests and memories). Structured UI, not a wall of text; every element links to its underlying item. Regenerate on demand; briefs are stored and browsable.
2. **Triage inbox** — one ranked feed of actionable items across Gmail, Slack, and Linear. Ranking = deterministic rules (direct mention > FYI) + cached LLM urgency scores (cheap model, batched at sync time). Actions per item: reply with AI (draft → approve/edit → send), convert to task, snooze, delegate to AI, done/archive. Keyboard-first (j/k navigation, single-key actions).
3. **Chat hub** — persistent conversations with any connected model. Tools give it real context: `search_items`, `get_schedule`, `create_task`, and connector actions. Outward-facing tool calls render as inline approval cards. Conversations feed the memory distiller.

Later surfaces: Automations editor, Approvals inbox, Memory browser, Usage dashboard, Settings — all specified below.

## Architecture

**Pattern:** one hosted core + thin native shells (the Linear/Notion/Slack model). All logic lives server-side on Railway; desktop and mobile are lightweight clients. This is the maintainability backbone: shells almost never change.

```
┌─ Clients ──────────────────────────────────────────┐
│  Tauri 2 desktop shell   │  Browser / PWA (mobile) │
│  (tray, notifications, global hotkey)              │
└───────────────┬────────────────────────────────────┘
                │ HTTPS
┌─ Railway ─────▼────────────────────────────────────┐
│  apps/web    — Next.js UI (app.yourdomain.com)     │
│  apps/api    — Hono on Bun.serve()                 │
│                (api.yourdomain.com)                │
│                BetterAuth, all HTTP endpoints,     │
│                webhook receivers                   │
│  apps/worker — Bun process: pg-boss consumer,      │
│                syncs, automations, briefings,      │
│                memory distillation                 │
│  Postgres    — app data (Drizzle) + job queue      │
│                (pg-boss) + vectors (pgvector)      │
└────────────────────────────────────────────────────┘
      │ outbound APIs + inbound webhooks
  Gmail / Slack / Linear / RSS / (Calendar, GitHub, …)
  Anthropic / OpenAI / … (LLM providers)
```

**Decisions and rationale:**

- **Hosted core on Railway** (user already runs projects there). OAuth callbacks, 24/7 automations, and webhooks need an always-on stable URL; a laptop doesn't provide one.
- **Standalone API service from day one** (user decision). Web UI deploys never restart webhook receivers; the API can scale/deploy independently; no risk of Next.js coupling. Cost accepted: cross-subdomain cookies (BetterAuth `crossSubDomainCookies` + trusted origins) and CORS configured in Phase 1, since everything depends on it.
- **Postgres does triple duty** — data, queue (pg-boss), vectors (pgvector). One database to operate, no Redis. If automations later outgrow pg-boss, Inngest/Temporal can be adopted without rearchitecting (jobs are already the unit of work).
- **Worker does not call the API.** It imports `packages/core` and `packages/db` directly — trusted in-process logic; HTTP hops would add failure modes. The API exists for clients (web, Tauri, PWA, future Expo).
- **Desktop = Tauri 2** wrapping the web app (~10MB, tray, native notifications, global hotkey). Electron rejected: heavier, buys nothing when logic is server-side.
- **Mobile = PWA first**, Expo/React Native later only if native UX is needed. Tauri mobile rejected as least-mature option.

## Monorepo layout (Bun workspaces)

```
home/
  apps/
    web/          Next.js UI (Tailwind + shadcn); no API routes
    api/          Thin server shell: mounts packages/api, Bun.serve()
    worker/       Bun job runner: pg-boss consumer, schedulers
    desktop/      Tauri 2 shell (Phase 6)
  packages/
    api/          Hono routers + exported AppType (typed RPC client)
    db/           Drizzle schema, migrations, query helpers
    core/         Domain logic: automations, briefings, triage, approvals
    connectors/   Provider framework + gmail/ slack/ linear/ rss/
    ai/           LLM provider abstraction, model registry, memory
    ui/           Shared shadcn components, design tokens
```

`apps/` = deployables; `packages/` = importables. Hono routers live in `packages/api` so any client can `import type { AppType } from '@home/api'` for end-to-end type safety with zero codegen, and so the server shell stays ~20 lines.

**Stack:** Bun (runtime + workspaces + test), TypeScript, Next.js, Tailwind, shadcn/ui, Hono, BetterAuth, Drizzle ORM, pg-boss, pgvector, Vercel AI SDK, Tauri 2.

## Connector framework (`packages/connectors`)

The extensibility seam — the user's tool list ends in "etc." Every provider implements one interface:

```ts
interface Connector {
  id: string                               // 'gmail' | 'slack' | 'linear' | 'rss' | …
  auth: OAuthConfig | null                 // scopes, endpoints, refresh; null for keyless (RSS)
  sync: {
    full(ctx: SyncContext): Promise<void>        // bounded backfill (e.g. 30 days)
    incremental(ctx: SyncContext): Promise<void> // delta via cursors/history IDs
  }
  webhooks?: WebhookHandler                // push updates where supported
  actions: Record<string, Action>          // sendEmail, postMessage, createIssue…
  normalize(raw: unknown): Item[]          // provider payload → unified Item
}
```

**Unified `Item` model.** Everything syncs into one normalized `items` table: `type` (email_thread | slack_message | linear_issue | news | …), `source`, `title`, `body`, `participants`, `timestamps`, `status`, `externalUrl`, `urgencyScore`, plus `raw` JSONB preserving full provider detail. Triage and briefing are *queries* over this table — every future connector appears in both automatically.

**Connection auth ≠ login auth.** BetterAuth answers "who are you." Connector OAuth tokens live in a `connections` table (encrypted, per-user, per-provider, multiple connections per provider allowed — e.g. two Gmail accounts). Revoking Slack never touches login.

**Sync strategies (all as pg-boss jobs — retried, cursor state per connection, never blocking UI):**

| Provider | Strategy |
|---|---|
| Gmail | History API polling (60–90s delta sync) |
| Slack | Events API webhooks + periodic reconciliation |
| Linear | Webhooks + GraphQL delta queries |
| RSS | Feed polling (keyless; user supplies URLs) |

Google Calendar comes nearly free later: same Google OAuth connection as Gmail, one additional scope.

**Actions are the write path** (send email, post message, create/comment issue). Connectors never decide autonomy — every action invocation passes through the approvals gate (see Automations).

Adding a provider = one new folder implementing the interface. Nothing else changes.

## AI layer (`packages/ai`)

**Provider abstraction:** built on the Vercel AI SDK (streaming, tool calling, structured output across Anthropic/OpenAI/Google/etc. behind one interface).

**Credentials:** `provider_accounts` table with `credentialType: 'api_key' | 'oauth'`. API keys always work. Subscription OAuth (e.g. "Sign in with ChatGPT"; Anthropic's equivalent) is provider-dependent and terms-restricted — each provider adapter declares what it supports, and adding subscription OAuth when a provider opens it officially is a new auth adapter, not a rearchitecture. **Implementation note: verify each provider's current OAuth stance at build time; this moved fast through 2025.**

**Model selection (`ModelResolver`):** one function every LLM call site goes through — `resolveModel(purpose, context)` — implementing a customizable cascade, most specific wins:

1. **Call-site pin** — e.g. the model picker on a chat conversation, or `modelOverride` on an automation or individual automation step
2. **Per-purpose preference** — user-configured in Settings: `chat`, `briefing`, `distillation`, `urgency_scoring`, `classification`, `automation_default`, each mapped to a model from their connected accounts
3. **Tier default** — purposes declare a tier (`frontier` | `fast`); the user sets one model per tier as the fallback

Preferences live in a `model_preferences` table (user-scoped; purpose → provider account + model). Resolution is pure logic in `packages/ai` — trivially unit-testable, and new purposes or levels are additive. If a resolved model's provider account is missing/broken, the resolver falls back down the cascade and the call is logged with the substitution so it's visible in usage tracking.

**Usage tracking:** every LLM call logged (provider, model, tokens, computed cost, purpose). The log powers the usage dashboard: spend by provider/purpose/day for API-key accounts; token/rate-window consumption for subscription accounts (which have no per-token price).

**Chat:** conversations + messages in Postgres, streamed over the API. Tools: `search_items`, `get_schedule`, `create_task`, connector actions. Outward-facing tool calls route through the approvals gate — chat respects tiered autonomy automatically. Context = retrieved memories + relevant items, never a raw data dump.

## Memory (`packages/ai/memory`)

`memories` table: `kind` (`fact` | `preference` | `person` | `project`), `content`, pgvector embedding, `source`, `confidence`, timestamps.

- **Writes:** background distillation jobs after chats and daily over new items. Dedup by vector similarity: update/supersede existing memories instead of appending, so memory doesn't silt up.
- **Reads:** hybrid retrieval (vector similarity + recency + kind filter), injected into chat context, briefing generation, and automation LLM steps.
- **Inspectability:** a Memory browser surface — view, edit, delete anything the system has learned. Trust requires visibility.

## Automations, autonomy, suggestions (`packages/core`)

**Model:** automation = trigger + conditions + action chain, stored as data.

- **Triggers:** schedule (cron via pg-boss schedules), event (`item.created` with filters, webhook events), manual.
- **Conditions:** deterministic filters (sender, keyword, label, project) and/or an LLM predicate ("is this urgent?").
- **Actions:** connector actions, internal actions (create task, file memory, notify), LLM steps (draft/summarize/decide) whose output feeds the next step.

**Model choice per automation:** an automation can set `modelOverride` for all its LLM work, and any individual LLM step or predicate can override that again — both feed level 1 of the `ModelResolver` cascade. Unset means the user's `automation_default` purpose preference applies. So "draft replies with the frontier model, but classify with the cheap one" is per-step configuration, not code.

Every run writes `automation_runs`: inputs, per-step outputs, outcome — full auditability of *why* something happened.

**Tiered autonomy** (user decision): each automation has `autonomyLevel: 'suggest' | 'approve' | 'auto'`, and each *action type* has a floor — outward-facing actions (send/post/comment) never run at `auto` unless explicitly overridden per-automation. Pending actions land in the **Approvals inbox** (approve / edit / reject, one tap). Approvals expire so stale drafts can't fire days later.

**Suggestions** = the system proposing automations to the user. A daily pattern-detection pass ("14 straight archived newsletters from X — auto-archive?") emits pre-filled automations awaiting a yes. Same data model as automations; no separate machinery.

**Creation UX:** natural language first — "every morning DM me my top 3 priorities" is compiled by the LLM into the structured trigger/condition/action form, which the user reviews and saves. Direct form editing also available.

## News in the briefing

- **RSS connector:** keyless; user adds feed URLs in Settings; worker polls; entries become `items` of `type: 'news'`. News therefore also flows through triage and can trigger automations ("feed mentions a competitor → Slack me") for free.
- **Topics:** user-defined interests ("AI tooling"). The briefing job runs web searches via a search API (Brave Search or Tavily; or LLM-provider built-in web search via the AI SDK), dedupes against RSS results, filters by interests and memories, and writes a capped News section — headlines, links, one-line whys.

## Security

- All third-party secrets (connector tokens, LLM keys) encrypted at rest: AES-256-GCM, key in Railway env. Documented upgrade path to per-user derived keys if the app ever hosts users who shouldn't trust the server operator.
- Every table row scoped by `userId` (org-scopable tables additionally by `organizationId`). Every `packages/db` query helper requires a scope argument — cross-user/cross-org leaks are structurally hard, not just policy. Org-shared rows are checked against `user_organizations` membership and role.
- Every API router behind BetterAuth session middleware. Cross-subdomain cookies (`app.` / `api.`) configured in Phase 1.
- Webhook endpoints verify provider signatures (Slack signing secret, Linear HMAC). Webhook handlers only enqueue jobs and return 200 — fast and failure-isolated.
- LLM calls only ever receive data already scoped to the requesting user.

## Error handling

- All external calls (connectors, LLMs) run as pg-boss jobs with exponential-backoff retries.
- Repeated auth failure marks a connection `needs_reattention` and surfaces a reconnect banner in the UI.
- Automation step failure halts the chain, records the error on the run, notifies the user.
- LLM outage degrades gracefully: briefing falls back to its structured non-AI form (schedule + counts) rather than failing.

## Testing

- **Unit (Bun test):** `core` logic — autonomy gating, ranking, memory dedup — with connectors and LLM mocked at their package interfaces (the interfaces are the test seams).
- **Integration:** API routes against a test Postgres.
- **Fixtures:** each connector's `normalize()` tested against recorded real provider payloads.
- **E2E:** deferred; Playwright smoke tests once the UI stabilizes (browser suites are high-maintenance early).

## Build phases (each independently shippable)

1. **Foundation** — monorepo scaffold; Postgres + Drizzle; BetterAuth (with organization plugin: orgs, `user_organizations`, invites) across `app.`/`api.` subdomains, cookies/CORS proven end-to-end; skeleton of all three services deployed to Railway.
2. **Connectors + triage** — Gmail/Slack/Linear sync into `items`; triage feed UI; manual actions (reply, archive, snooze).
3. **AI core** — provider accounts (API keys), chat hub with tools, memory tables + distillation, usage logging.
4. **Briefing** — briefing job + UI; RSS connector; news topics.
5. **Automations** — engine, tiered autonomy, approvals inbox, NL builder, suggestions.
6. **Shells** — Tauri desktop (tray, notifications, hotkey); PWA polish for mobile.

## UI direction

Sidebar app: Briefing / Triage / Chat / Automations / Approvals / Memory / Settings. shadcn/ui components, single accent color, dense-but-calm layout, keyboard-first interactions, dark mode from day one.

## Explicitly deferred

- Google Calendar, Drive, GitHub, PostHog, Vercel, Metabase connectors (framework makes each a bounded add)
- Expo/React Native mobile app (PWA first)
- Org-sharing UI for connections/automations (schema supports it day one; UI lands with the Automations phase)
- Subscription OAuth for LLM providers where not officially supported
- Inngest/Temporal (only if automations outgrow pg-boss)
