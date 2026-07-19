import { createHash, randomBytes, randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Auth } from "@home/auth";
import {
  encryptCredential,
  getConnector,
  getConnectorCredentials,
  isConnectorId,
  listConnectors,
} from "@home/connectors";
import { JOBS, type JobName } from "@home/core";
import { type Database, schema } from "@home/db";
import { and, asc, desc, eq, gt, isNull, lt, max, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { validator } from "hono/validator";

type Variables = {
  session: Auth["$Infer"]["Session"]["session"] | null;
  user: Auth["$Infer"]["Session"]["user"] | null;
};

const authorizeBody = validator(
  "json",
  (value) => (value && typeof value === "object" ? value : {}) as { returnTo?: string },
);
const updateItemBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      status?: string;
      snoozedUntil?: string;
    },
);
const itemActionBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      action?: string;
      input?: Record<string, unknown>;
    },
);
const providerAccountBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      apiKey?: string;
      label?: string;
      provider?: string;
    },
);
const modelPreferenceBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      model?: string;
      providerAccountId?: string;
    },
);
const sessionBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      effort?: string;
      enabledToolsets?: string[];
      kind?: string;
      mode?: string;
      modelOverride?: string;
      providerAccountId?: string;
      title?: string;
    },
);
const messageBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      attachmentIds?: string[];
      content?: string;
      model?: string;
      providerAccountId?: string;
    },
);
const memoryBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      confidence?: number;
      content?: string;
      kind?: string;
    },
);
const attachmentBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      contentType?: string;
      fileName?: string;
      sessionId?: string;
      sizeBytes?: number;
    },
);
const briefingPreferencesBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      deliveryHour?: number;
      enabled?: boolean;
      newsLimit?: number;
      timezone?: string;
    },
);
const feedBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      title?: string;
      url?: string;
    },
);
const topicBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      topic?: string;
    },
);

const MODEL_CATALOG = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
} as const;

const MODEL_PURPOSES = [
  "chat",
  "briefing",
  "distillation",
  "urgency_scoring",
  "classification",
  "automation_default",
] as const;

function isAiProvider(value: string): value is keyof typeof MODEL_CATALOG {
  return value in MODEL_CATALOG;
}

export type ApiDependencies = {
  auth: Pick<Auth, "api" | "handler">;
  credentialEncryptionKey?: string;
  database?: Database;
  enqueue?: (name: JobName, data: object) => Promise<string | null>;
  publicURL?: string;
  trustedOrigins: string[];
  webURL?: string;
};

function safeReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/?view=settings";
}

export function createApi({
  auth,
  credentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY,
  database,
  enqueue,
  publicURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  trustedOrigins,
  webURL = process.env.WEB_URL ?? "http://localhost:3000",
}: ApiDependencies) {
  const app = new Hono<{ Variables: Variables }>();

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) => (trustedOrigins.includes(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["Content-Length", "X-Request-Id"],
      maxAge: 600,
      credentials: true,
    }),
  );

  app.use("/v1/*", async (context, next) => {
    const result = await auth.api.getSession({ headers: context.req.raw.headers });
    context.set("user", result?.user ?? null);
    context.set("session", result?.session ?? null);
    await next();
  });

  const routes = app
    .get("/health", (context) =>
      context.json({
        status: "ok" as const,
        service: "api" as const,
        timestamp: new Date().toISOString(),
      }),
    )
    .on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw))
    .get("/v1/me", (context) => {
      const user = context.get("user");
      const session = context.get("session");
      if (!user || !session) return context.json({ error: "Unauthorized" as const }, 401);
      return context.json({ user, session });
    })
    .get("/v1/connectors", (context) => {
      if (!context.get("user")) return context.json({ error: "Unauthorized" as const }, 401);
      return context.json(
        listConnectors().map((connector) => ({
          ...connector,
          available: Boolean(getConnectorCredentials(connector.id)),
        })),
      );
    })
    .get("/v1/connections", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);

      const rows = await database
        .select({
          id: schema.connections.id,
          provider: schema.connections.provider,
          label: schema.connections.label,
          status: schema.connections.status,
          scopes: schema.connections.scopes,
          lastSyncedAt: schema.connections.lastSyncedAt,
          lastError: schema.connections.lastError,
          createdAt: schema.connections.createdAt,
        })
        .from(schema.connections)
        .where(eq(schema.connections.userId, user.id))
        .orderBy(desc(schema.connections.createdAt));

      return context.json(rows);
    })
    .post("/v1/connections/:provider/authorize", authorizeBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);

      const provider = context.req.param("provider");
      if (!isConnectorId(provider)) {
        return context.json({ error: "Unsupported connector" as const }, 404);
      }
      const credentials = getConnectorCredentials(provider);
      if (!credentials) {
        return context.json({ error: `${provider} OAuth is not configured` }, 409);
      }

      const body = context.req.valid("json");
      const state = randomBytes(32).toString("base64url");
      const codeVerifier = randomBytes(48).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const redirectURI = `${publicURL}/v1/connections/${provider}/callback`;

      await database.insert(schema.connectorOauthStates).values({
        state,
        userId: user.id,
        provider,
        codeVerifier,
        returnTo: safeReturnTo(body.returnTo),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const authorizationURL = getConnector(provider).createAuthorizationURL({
        ...credentials,
        codeChallenge,
        redirectURI,
        state,
      });
      return context.json({ url: authorizationURL.toString() });
    })
    .get("/v1/connections/:provider/callback", async (context) => {
      const user = context.get("user");
      if (!user) return context.redirect(`${webURL}/?connection_error=session_required`);
      if (!database) return context.redirect(`${webURL}/?connection_error=database_unavailable`);

      const provider = context.req.param("provider");
      if (!isConnectorId(provider)) {
        return context.redirect(`${webURL}/?connection_error=unsupported_connector`);
      }
      const error = context.req.query("error");
      if (error)
        return context.redirect(`${webURL}/?connection_error=${encodeURIComponent(error)}`);

      const state = context.req.query("state");
      const code = context.req.query("code");
      if (!state || !code) return context.redirect(`${webURL}/?connection_error=missing_callback`);

      const [oauthState] = await database
        .select()
        .from(schema.connectorOauthStates)
        .where(
          and(
            eq(schema.connectorOauthStates.state, state),
            eq(schema.connectorOauthStates.userId, user.id),
            eq(schema.connectorOauthStates.provider, provider),
            gt(schema.connectorOauthStates.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!oauthState) return context.redirect(`${webURL}/?connection_error=invalid_state`);

      const credentials = getConnectorCredentials(provider);
      if (!credentials || !credentialEncryptionKey) {
        return context.redirect(`${webURL}/?connection_error=connector_not_configured`);
      }

      try {
        const connector = getConnector(provider);
        const redirectURI = `${publicURL}/v1/connections/${provider}/callback`;
        const tokens = await connector.exchangeCode({
          ...credentials,
          code,
          codeVerifier: oauthState.codeVerifier ?? undefined,
          redirectURI,
        });
        const identity = await connector.getIdentity(tokens.accessToken);
        const encryptedAccessToken = await encryptCredential(
          tokens.accessToken,
          credentialEncryptionKey,
        );
        const encryptedRefreshToken = tokens.refreshToken
          ? await encryptCredential(tokens.refreshToken, credentialEncryptionKey)
          : undefined;
        const id = randomUUID();
        const [connection] = await database
          .insert(schema.connections)
          .values({
            id,
            userId: user.id,
            organizationId: oauthState.organizationId,
            provider,
            externalAccountId: identity.externalAccountId,
            label: identity.label,
            encryptedAccessToken,
            encryptedRefreshToken,
            tokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            metadata: identity.metadata ?? {},
          })
          .onConflictDoUpdate({
            target: [
              schema.connections.userId,
              schema.connections.provider,
              schema.connections.externalAccountId,
            ],
            set: {
              label: identity.label,
              status: "active",
              encryptedAccessToken,
              encryptedRefreshToken,
              tokenExpiresAt: tokens.expiresAt,
              scopes: tokens.scopes,
              metadata: identity.metadata ?? {},
              lastError: null,
              updatedAt: new Date(),
            },
          })
          .returning({ id: schema.connections.id });

        await database
          .delete(schema.connectorOauthStates)
          .where(eq(schema.connectorOauthStates.state, state));
        if (connection && enqueue) {
          await enqueue(JOBS.syncConnection, { connectionId: connection.id, userId: user.id });
        }
        return context.redirect(
          `${webURL}${oauthState.returnTo}${oauthState.returnTo.includes("?") ? "&" : "?"}connected=${provider}`,
        );
      } catch (callbackError) {
        console.error(`${provider} connection callback failed`, callbackError);
        return context.redirect(`${webURL}/?connection_error=oauth_exchange_failed`);
      }
    })
    .post("/v1/connections/:id/sync", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !enqueue) return context.json({ error: "Queue unavailable" as const }, 503);

      const [connection] = await database
        .select({ id: schema.connections.id })
        .from(schema.connections)
        .where(
          and(
            eq(schema.connections.id, context.req.param("id")),
            eq(schema.connections.userId, user.id),
          ),
        )
        .limit(1);
      if (!connection) return context.json({ error: "Connection not found" as const }, 404);
      const jobId = await enqueue(JOBS.syncConnection, {
        connectionId: connection.id,
        userId: user.id,
      });
      return context.json({ jobId, queued: true as const }, 202);
    })
    .delete("/v1/connections/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.connections)
        .where(
          and(
            eq(schema.connections.id, context.req.param("id")),
            eq(schema.connections.userId, user.id),
          ),
        )
        .returning({ id: schema.connections.id });
      if (!deleted.length) return context.json({ error: "Connection not found" as const }, 404);
      return context.json({ disconnected: true as const });
    })
    .get("/v1/items", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);

      const provider = context.req.query("provider");
      const rows = await database
        .select()
        .from(schema.items)
        .where(
          and(
            eq(schema.items.userId, user.id),
            isNull(schema.items.organizationId),
            or(
              eq(schema.items.status, "open"),
              and(eq(schema.items.status, "snoozed"), lt(schema.items.snoozedUntil, new Date())),
            ),
            provider && isConnectorId(provider) ? eq(schema.items.provider, provider) : undefined,
          ),
        )
        .orderBy(desc(schema.items.urgencyScore), desc(schema.items.occurredAt))
        .limit(100);
      return context.json(rows);
    })
    .patch("/v1/items/:id", updateItemBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      const allowedStatuses = ["open", "done", "archived", "snoozed"] as const;
      if (!body.status || !inArrayValue(allowedStatuses, body.status)) {
        return context.json({ error: "Invalid item status" as const }, 400);
      }
      const [updated] = await database
        .update(schema.items)
        .set({
          status: body.status,
          snoozedUntil:
            body.status === "snoozed" && body.snoozedUntil ? new Date(body.snoozedUntil) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.items.id, context.req.param("id")), eq(schema.items.userId, user.id)))
        .returning();
      if (!updated) return context.json({ error: "Item not found" as const }, 404);
      return context.json(updated);
    })
    .post("/v1/items/:id/actions", itemActionBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !enqueue) return context.json({ error: "Queue unavailable" as const }, 503);
      const body = context.req.valid("json");
      if (
        !body.action ||
        !["archive", "mark-read", "reply", "comment", "post"].includes(body.action)
      ) {
        return context.json({ error: "Invalid connector action" as const }, 400);
      }
      const [item] = await database
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(and(eq(schema.items.id, context.req.param("id")), eq(schema.items.userId, user.id)))
        .limit(1);
      if (!item) return context.json({ error: "Item not found" as const }, 404);

      const requestId = randomUUID();
      await database.insert(schema.itemActionRequests).values({
        id: requestId,
        userId: user.id,
        itemId: item.id,
        action: body.action,
        input: body.input ?? {},
      });
      const jobId = await enqueue(JOBS.executeItemAction, { requestId, userId: user.id });
      return context.json({ jobId, requestId, queued: true as const }, 202);
    })
    .get("/v1/models", (context) => {
      if (!context.get("user")) return context.json({ error: "Unauthorized" as const }, 401);
      return context.json({ models: MODEL_CATALOG, purposes: MODEL_PURPOSES });
    })
    .get("/v1/provider-accounts", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const accounts = await database
        .select({
          id: schema.providerAccounts.id,
          provider: schema.providerAccounts.provider,
          credentialType: schema.providerAccounts.credentialType,
          label: schema.providerAccounts.label,
          status: schema.providerAccounts.status,
          createdAt: schema.providerAccounts.createdAt,
        })
        .from(schema.providerAccounts)
        .where(eq(schema.providerAccounts.userId, user.id))
        .orderBy(desc(schema.providerAccounts.createdAt));
      return context.json(accounts);
    })
    .post("/v1/provider-accounts", providerAccountBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !credentialEncryptionKey) {
        return context.json({ error: "Credential storage unavailable" as const }, 503);
      }
      const body = context.req.valid("json");
      if (!body.provider || !isAiProvider(body.provider) || !body.apiKey?.trim()) {
        return context.json({ error: "Provider and API key are required" as const }, 400);
      }
      const id = randomUUID();
      const [account] = await database
        .insert(schema.providerAccounts)
        .values({
          id,
          userId: user.id,
          provider: body.provider,
          label: body.label?.trim() || `${body.provider} account`,
          encryptedCredential: await encryptCredential(body.apiKey.trim(), credentialEncryptionKey),
        })
        .returning({
          id: schema.providerAccounts.id,
          provider: schema.providerAccounts.provider,
          label: schema.providerAccounts.label,
          status: schema.providerAccounts.status,
        });
      return context.json(account, 201);
    })
    .delete("/v1/provider-accounts/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.providerAccounts)
        .where(
          and(
            eq(schema.providerAccounts.id, context.req.param("id")),
            eq(schema.providerAccounts.userId, user.id),
          ),
        )
        .returning({ id: schema.providerAccounts.id });
      if (!deleted.length) return context.json({ error: "Provider account not found" }, 404);
      return context.json({ deleted: true as const });
    })
    .get("/v1/model-preferences", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.modelPreferences)
          .where(eq(schema.modelPreferences.userId, user.id)),
      );
    })
    .put("/v1/model-preferences/:purpose", modelPreferenceBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const purpose = context.req.param("purpose");
      const body = context.req.valid("json");
      if (
        !inArrayValue(MODEL_PURPOSES, purpose) ||
        !body.providerAccountId ||
        !body.model?.trim()
      ) {
        return context.json({ error: "Valid purpose, account, and model are required" }, 400);
      }
      const [account] = await database
        .select({ id: schema.providerAccounts.id })
        .from(schema.providerAccounts)
        .where(
          and(
            eq(schema.providerAccounts.id, body.providerAccountId),
            eq(schema.providerAccounts.userId, user.id),
          ),
        )
        .limit(1);
      if (!account) return context.json({ error: "Provider account not found" }, 404);
      const [preference] = await database
        .insert(schema.modelPreferences)
        .values({
          id: randomUUID(),
          userId: user.id,
          purpose,
          providerAccountId: account.id,
          model: body.model.trim(),
        })
        .onConflictDoUpdate({
          target: [schema.modelPreferences.userId, schema.modelPreferences.purpose],
          set: {
            providerAccountId: account.id,
            model: body.model.trim(),
            updatedAt: new Date(),
          },
        })
        .returning();
      return context.json(preference);
    })
    .get("/v1/sessions", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const sessions = await database
        .select()
        .from(schema.agentSessions)
        .where(eq(schema.agentSessions.userId, user.id))
        .orderBy(desc(schema.agentSessions.lastActivityAt))
        .limit(100);
      return context.json(sessions);
    })
    .post("/v1/sessions", sessionBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      const kind = body.kind === "coding" ? "coding" : "chat";
      if (kind === "coding") {
        return context.json({ error: "Coding sessions require the desktop sidecar" as const }, 409);
      }
      const mode =
        body.mode === "plan" || body.mode === "ask" || body.mode === "auto" ? body.mode : "ask";
      const [session] = await database
        .insert(schema.agentSessions)
        .values({
          id: randomUUID(),
          userId: user.id,
          title: body.title?.trim() || "New session",
          kind,
          backend: "hosted",
          mode,
          effort: body.effort ?? "medium",
          enabledToolsets: body.enabledToolsets ?? ["items", "memory"],
          providerAccountId: body.providerAccountId,
          modelOverride: body.modelOverride,
        })
        .returning();
      return context.json(session, 201);
    })
    .get("/v1/sessions/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [session] = await database
        .select()
        .from(schema.agentSessions)
        .where(
          and(
            eq(schema.agentSessions.id, context.req.param("id")),
            eq(schema.agentSessions.userId, user.id),
          ),
        )
        .limit(1);
      if (!session) return context.json({ error: "Session not found" as const }, 404);
      return context.json(session);
    })
    .patch("/v1/sessions/:id", sessionBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      const mode =
        body.mode && inArrayValue(["plan", "ask", "auto"] as const, body.mode)
          ? body.mode
          : undefined;
      const [session] = await database
        .update(schema.agentSessions)
        .set({
          ...(body.title !== undefined ? { title: body.title.trim() || "New session" } : {}),
          ...(body.providerAccountId !== undefined
            ? { providerAccountId: body.providerAccountId || null }
            : {}),
          ...(body.modelOverride !== undefined
            ? { modelOverride: body.modelOverride || null }
            : {}),
          ...(body.effort !== undefined ? { effort: body.effort } : {}),
          ...(mode ? { mode } : {}),
          ...(body.enabledToolsets ? { enabledToolsets: body.enabledToolsets } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.agentSessions.id, context.req.param("id")),
            eq(schema.agentSessions.userId, user.id),
          ),
        )
        .returning();
      if (!session) return context.json({ error: "Session not found" as const }, 404);
      return context.json(session);
    })
    .get("/v1/sessions/:id/events", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const after = Number(context.req.query("after") ?? 0);
      const events = await database
        .select()
        .from(schema.sessionEvents)
        .where(
          and(
            eq(schema.sessionEvents.sessionId, context.req.param("id")),
            eq(schema.sessionEvents.userId, user.id),
            after > 0 ? gt(schema.sessionEvents.sequence, after) : undefined,
          ),
        )
        .orderBy(asc(schema.sessionEvents.sequence))
        .limit(500);
      return context.json(events);
    })
    .post("/v1/sessions/:id/messages", messageBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !enqueue) return context.json({ error: "Queue unavailable" as const }, 503);
      const body = context.req.valid("json");
      if (!body.content?.trim()) return context.json({ error: "Message content is required" }, 400);
      const [session] = await database
        .select()
        .from(schema.agentSessions)
        .where(
          and(
            eq(schema.agentSessions.id, context.req.param("id")),
            eq(schema.agentSessions.userId, user.id),
          ),
        )
        .limit(1);
      if (!session) return context.json({ error: "Session not found" as const }, 404);
      if (session.backend !== "hosted") {
        return context.json({ error: "The desktop sidecar owns this session" as const }, 409);
      }

      const sequenceRows = await database
        .select({ sequence: max(schema.sessionEvents.sequence) })
        .from(schema.sessionEvents)
        .where(eq(schema.sessionEvents.sessionId, session.id));
      const eventId = randomUUID();
      await database.insert(schema.sessionEvents).values({
        id: eventId,
        userId: user.id,
        sessionId: session.id,
        sequence: (sequenceRows[0]?.sequence ?? 0) + 1,
        type: "message",
        role: "user",
        content: body.content.trim(),
        model: body.model,
        payload: { attachmentIds: body.attachmentIds ?? [] },
      });
      const runId = randomUUID();
      await database.insert(schema.sessionRuns).values({
        id: runId,
        userId: user.id,
        sessionId: session.id,
        inputEventId: eventId,
      });
      await database
        .update(schema.agentSessions)
        .set({
          status: "queued",
          providerAccountId: body.providerAccountId ?? session.providerAccountId,
          modelOverride: body.model ?? session.modelOverride,
          lastActivityAt: new Date(),
          lastError: null,
        })
        .where(eq(schema.agentSessions.id, session.id));
      const jobId = await enqueue(JOBS.runSession, {
        runId,
        sessionId: session.id,
        userId: user.id,
      });
      return context.json({ eventId, jobId, queued: true as const, runId }, 202);
    })
    .get("/v1/memories", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select({
            id: schema.memories.id,
            kind: schema.memories.kind,
            content: schema.memories.content,
            source: schema.memories.source,
            confidence: schema.memories.confidence,
            createdAt: schema.memories.createdAt,
            updatedAt: schema.memories.updatedAt,
          })
          .from(schema.memories)
          .where(and(eq(schema.memories.userId, user.id), isNull(schema.memories.supersededAt)))
          .orderBy(desc(schema.memories.updatedAt)),
      );
    })
    .post("/v1/memories", memoryBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      const kinds = ["fact", "preference", "person", "project"] as const;
      if (!body.content?.trim() || !body.kind || !inArrayValue(kinds, body.kind)) {
        return context.json({ error: "Memory kind and content are required" }, 400);
      }
      const [memory] = await database
        .insert(schema.memories)
        .values({
          id: randomUUID(),
          userId: user.id,
          kind: body.kind,
          content: body.content.trim(),
          source: "manual",
          confidence: body.confidence ?? 1,
        })
        .returning();
      return context.json(memory, 201);
    })
    .patch("/v1/memories/:id", memoryBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      const kinds = ["fact", "preference", "person", "project"] as const;
      const kind = body.kind && inArrayValue(kinds, body.kind) ? body.kind : undefined;
      const [memory] = await database
        .update(schema.memories)
        .set({
          ...(body.content?.trim() ? { content: body.content.trim() } : {}),
          ...(kind ? { kind } : {}),
          ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.memories.id, context.req.param("id")), eq(schema.memories.userId, user.id)),
        )
        .returning();
      if (!memory) return context.json({ error: "Memory not found" as const }, 404);
      return context.json(memory);
    })
    .delete("/v1/memories/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.memories)
        .where(
          and(eq(schema.memories.id, context.req.param("id")), eq(schema.memories.userId, user.id)),
        )
        .returning({ id: schema.memories.id });
      if (!deleted.length) return context.json({ error: "Memory not found" as const }, 404);
      return context.json({ deleted: true as const });
    })
    .get("/v1/usage", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [totals] = await database
        .select({
          calls: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${schema.usageLogs.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${schema.usageLogs.outputTokens}), 0)::int`,
          estimatedCostUsd: sql<number>`coalesce(sum(${schema.usageLogs.estimatedCostUsd}), 0)::float8`,
        })
        .from(schema.usageLogs)
        .where(eq(schema.usageLogs.userId, user.id));
      const recent = await database
        .select()
        .from(schema.usageLogs)
        .where(eq(schema.usageLogs.userId, user.id))
        .orderBy(desc(schema.usageLogs.createdAt))
        .limit(100);
      return context.json({ recent, totals });
    })
    .post("/v1/attachments/presign", attachmentBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      if (!body.fileName || !body.contentType || !body.sizeBytes || body.sizeBytes > 50_000_000) {
        return context.json({ error: "A file up to 50 MB is required" as const }, 400);
      }
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      const bucket = process.env.R2_BUCKET;
      if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        return context.json({ error: "Attachment storage is not configured" as const }, 409);
      }
      if (body.sessionId) {
        const [session] = await database
          .select({ id: schema.agentSessions.id })
          .from(schema.agentSessions)
          .where(
            and(
              eq(schema.agentSessions.id, body.sessionId),
              eq(schema.agentSessions.userId, user.id),
            ),
          )
          .limit(1);
        if (!session) return context.json({ error: "Session not found" as const }, 404);
      }
      const id = randomUUID();
      const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
      const objectKey = `${user.id}/${id}/${safeName}`;
      const client = new S3Client({
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        credentials: { accessKeyId, secretAccessKey },
      });
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          ContentType: body.contentType,
          ContentLength: body.sizeBytes,
        }),
        { expiresIn: 900 },
      );
      await database.insert(schema.attachments).values({
        id,
        userId: user.id,
        sessionId: body.sessionId,
        objectKey,
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
      });
      return context.json({ attachmentId: id, objectKey, uploadUrl }, 201);
    })
    .post("/v1/attachments/:id/complete", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [attachment] = await database
        .update(schema.attachments)
        .set({ status: "ready" })
        .where(
          and(
            eq(schema.attachments.id, context.req.param("id")),
            eq(schema.attachments.userId, user.id),
          ),
        )
        .returning();
      if (!attachment) return context.json({ error: "Attachment not found" as const }, 404);
      return context.json(attachment);
    })
    .get("/v1/briefings/latest", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [briefing] = await database
        .select()
        .from(schema.briefings)
        .where(eq(schema.briefings.userId, user.id))
        .orderBy(desc(schema.briefings.generatedAt))
        .limit(1);
      return context.json(briefing ?? null);
    })
    .get("/v1/briefings", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.briefings)
          .where(eq(schema.briefings.userId, user.id))
          .orderBy(desc(schema.briefings.generatedAt))
          .limit(30),
      );
    })
    .post("/v1/briefings/generate", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!enqueue) return context.json({ error: "Queue unavailable" as const }, 503);
      const jobId = await enqueue(JOBS.generateBriefing, { userId: user.id, force: true });
      return context.json({ jobId, queued: true as const }, 202);
    })
    .get("/v1/briefing-preferences", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [preference] = await database
        .select()
        .from(schema.briefingPreferences)
        .where(eq(schema.briefingPreferences.userId, user.id))
        .limit(1);
      return context.json(
        preference ?? {
          timezone: "America/New_York",
          deliveryHour: 7,
          newsLimit: 8,
          enabled: true,
        },
      );
    })
    .put("/v1/briefing-preferences", briefingPreferencesBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      if (
        !body.timezone ||
        body.deliveryHour === undefined ||
        body.deliveryHour < 0 ||
        body.deliveryHour > 23 ||
        body.newsLimit === undefined ||
        body.newsLimit < 0 ||
        body.newsLimit > 20
      ) {
        return context.json({ error: "Valid timezone, hour, and news limit are required" }, 400);
      }
      try {
        Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
      } catch {
        return context.json({ error: "Invalid IANA timezone" as const }, 400);
      }
      const [preference] = await database
        .insert(schema.briefingPreferences)
        .values({
          id: randomUUID(),
          userId: user.id,
          timezone: body.timezone,
          deliveryHour: body.deliveryHour,
          newsLimit: body.newsLimit,
          enabled: body.enabled ?? true,
        })
        .onConflictDoUpdate({
          target: schema.briefingPreferences.userId,
          set: {
            timezone: body.timezone,
            deliveryHour: body.deliveryHour,
            newsLimit: body.newsLimit,
            enabled: body.enabled ?? true,
            updatedAt: new Date(),
          },
        })
        .returning();
      return context.json(preference);
    })
    .get("/v1/rss-feeds", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.rssFeeds)
          .where(eq(schema.rssFeeds.userId, user.id))
          .orderBy(asc(schema.rssFeeds.title)),
      );
    })
    .post("/v1/rss-feeds", feedBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !enqueue) return context.json({ error: "Queue unavailable" as const }, 503);
      const body = context.req.valid("json");
      if (!body.url) return context.json({ error: "Feed URL is required" as const }, 400);
      let url: URL;
      try {
        url = new URL(body.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid protocol");
      } catch {
        return context.json({ error: "A valid HTTP(S) feed URL is required" as const }, 400);
      }
      const id = randomUUID();
      const [feed] = await database
        .insert(schema.rssFeeds)
        .values({
          id,
          userId: user.id,
          url: url.toString(),
          title: body.title?.trim() || url.hostname,
        })
        .onConflictDoUpdate({
          target: [schema.rssFeeds.userId, schema.rssFeeds.url],
          set: { active: true, title: body.title?.trim() || url.hostname, updatedAt: new Date() },
        })
        .returning();
      if (feed) await enqueue(JOBS.syncFeed, { feedId: feed.id, userId: user.id });
      return context.json(feed, 201);
    })
    .post("/v1/rss-feeds/:id/sync", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !enqueue) return context.json({ error: "Queue unavailable" as const }, 503);
      const [feed] = await database
        .select({ id: schema.rssFeeds.id })
        .from(schema.rssFeeds)
        .where(
          and(eq(schema.rssFeeds.id, context.req.param("id")), eq(schema.rssFeeds.userId, user.id)),
        )
        .limit(1);
      if (!feed) return context.json({ error: "Feed not found" as const }, 404);
      const jobId = await enqueue(JOBS.syncFeed, { feedId: feed.id, userId: user.id });
      return context.json({ jobId, queued: true as const }, 202);
    })
    .delete("/v1/rss-feeds/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.rssFeeds)
        .where(
          and(eq(schema.rssFeeds.id, context.req.param("id")), eq(schema.rssFeeds.userId, user.id)),
        )
        .returning({ id: schema.rssFeeds.id });
      if (!deleted.length) return context.json({ error: "Feed not found" as const }, 404);
      return context.json({ deleted: true as const });
    })
    .get("/v1/news-topics", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.newsTopics)
          .where(eq(schema.newsTopics.userId, user.id))
          .orderBy(asc(schema.newsTopics.topic)),
      );
    })
    .post("/v1/news-topics", topicBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const topic = context.req.valid("json").topic?.trim();
      if (!topic || topic.length > 120)
        return context.json({ error: "A short topic is required" }, 400);
      const [row] = await database
        .insert(schema.newsTopics)
        .values({ id: randomUUID(), userId: user.id, topic })
        .onConflictDoUpdate({
          target: [schema.newsTopics.userId, schema.newsTopics.topic],
          set: { active: true },
        })
        .returning();
      return context.json(row, 201);
    })
    .delete("/v1/news-topics/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.newsTopics)
        .where(
          and(
            eq(schema.newsTopics.id, context.req.param("id")),
            eq(schema.newsTopics.userId, user.id),
          ),
        )
        .returning({ id: schema.newsTopics.id });
      if (!deleted.length) return context.json({ error: "Topic not found" as const }, 404);
      return context.json({ deleted: true as const });
    });

  app.notFound((context) => context.json({ error: "Not found" as const }, 404));
  app.onError((error, context) => {
    console.error(error);
    return context.json({ error: "Internal server error" as const }, 500);
  });

  return routes;
}

function inArrayValue<T extends string>(values: readonly T[], value: string): value is T {
  return values.includes(value as T);
}
