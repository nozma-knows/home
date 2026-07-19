# Production operations

## Railway services

Create `web`, `api`, and `worker` services from the repository and one Railway Postgres service.
Use the config-as-code path matching each service:

| Service | Railway config | Domain |
| --- | --- | --- |
| web | `/apps/web/railway.toml` | `home.milbo.co` |
| api | `/apps/api/railway.toml` | `home-api.milbo.co` |
| worker | `/apps/worker/railway.toml` | private only |

The API and worker must reference the same `DATABASE_URL`. The API start lifecycle must run
`bun run db:migrate` before `bun run --cwd apps/api start`; the checked-in Railway config already
does this as a pre-deploy command.

## Required environment variables

API:

```text
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL=https://home-api.milbo.co
WEB_URL=https://home.milbo.co
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
CREDENTIAL_ENCRYPTION_KEY
```

Web:

```text
NEXT_PUBLIC_API_URL=https://home-api.milbo.co
```

Worker:

```text
DATABASE_URL
CREDENTIAL_ENCRYPTION_KEY
WORKER_NAME=home-worker
```

Copy connector OAuth client credentials to the worker as well so it can refresh expiring access
tokens. Gmail uses `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (or the dedicated `GMAIL_*`
overrides); add the Slack/Linear client credentials when those connectors are enabled.

Use sibling domains with `AUTH_CROSS_SITE_COOKIES=false`. `AUTH_COOKIE_DOMAIN=milbo.co` is
optional because requests always send the host-only auth cookie to the API. Generate auth and
encryption secrets independently with `openssl rand -base64 32`.

## OAuth and email

Google OAuth web client:

- Authorized JavaScript origin: `https://home.milbo.co`
- Login redirect: `https://home-api.milbo.co/api/auth/callback/google`
- Gmail connector redirect: `https://home-api.milbo.co/v1/connections/gmail/callback`

The Gmail API must be enabled for the Google Cloud project. The Gmail connection can reuse
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` can
override them.

Resend requires a verified sending domain and a sender such as
`home <auth@milbo.co>` in `RESEND_FROM_EMAIL`.

Optional Slack connection:

```text
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_SIGNING_SECRET
```

Redirect: `https://home-api.milbo.co/v1/connections/slack/callback`.

Optional Linear connection:

```text
LINEAR_CLIENT_ID
LINEAR_CLIENT_SECRET
LINEAR_WEBHOOK_SECRET
```

Redirect: `https://home-api.milbo.co/v1/connections/linear/callback`.

## Optional services

Attachments use a private Cloudflare R2 bucket:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET=home-attachments
```

The bucket CORS policy must allow `PUT` from `https://home.milbo.co` with the `Content-Type`
header. Topic-based briefing search uses `TAVILY_API_KEY` on the worker. RSS and deterministic
briefings continue to work without Tavily.

Slack, Linear, R2, and Tavily degrade with an explicit configuration message when their optional
credentials are absent.

## User setup

After signing in:

1. Open Settings and add at least one OpenAI, Anthropic, or Google AI API key.
2. Select the default chat model. Per-session model selection can override it at any time.
3. Connect Gmail, Slack, or Linear and run the initial sync.
4. Add RSS feeds and news topics, then choose the briefing timezone and delivery hour.
5. Install the PWA from the browser or build/open the macOS app for local coding sessions.

## Verification and recovery

```sh
curl -fsS https://home-api.milbo.co/health
curl -fsSI https://home.milbo.co
railway service status --all --environment production
railway logs --service api --environment production --lines 100
railway logs --service worker --environment production --lines 100
```

An unauthenticated `GET https://home-api.milbo.co/v1/me` should return `401`. A failed provider
sync is retried by pg-boss and recorded on the connection. Reconnect any connection marked
`needs_reattention`. Never delete the Postgres volume or change `CREDENTIAL_ENCRYPTION_KEY` as a
routine recovery step.
