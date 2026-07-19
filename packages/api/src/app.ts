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
import { compileAutomationPrompt, JOBS, type JobName } from "@home/core";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationStatus,
  AutomationTrigger,
  AutonomyLevel,
} from "@home/db";
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
const automationBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      actions?: Array<{
        id?: string;
        type?: string;
        config?: Record<string, unknown>;
        modelOverride?: string;
      }>;
      allowAutoExternal?: boolean;
      autonomyLevel?: string;
      conditions?: Array<{
        field?: string;
        operator?: string;
        value?: string | boolean;
      }>;
      description?: string;
      modelOverride?: string;
      name?: string;
      prompt?: string;
      providerAccountId?: string;
      status?: string;
      trigger?: Record<string, unknown>;
    },
);
const approvalBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      editedPayload?: Record<string, unknown>;
    },
);
const mcpBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      command?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
      name?: string;
      transport?: string;
      url?: string;
    },
);
const pluginBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      description?: string;
      enabled?: boolean;
      instructions?: string;
      name?: string;
      slashCommand?: string;
    },
);
const forkPlanBody = validator(
  "json",
  (value) =>
    (value && typeof value === "object" ? value : {}) as {
      backend?: string;
      effort?: string;
      mode?: string;
      modelOverride?: string;
      providerAccountId?: string;
      title?: string;
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
    })
    .post("/v1/automations/compile", automationBody, (context) => {
      if (!context.get("user")) return context.json({ error: "Unauthorized" as const }, 401);
      const prompt = context.req.valid("json").prompt?.trim();
      if (!prompt) return context.json({ error: "Describe the automation first" as const }, 400);
      return context.json(compileAutomationPrompt(prompt));
    })
    .get("/v1/automations", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.automations)
          .where(eq(schema.automations.userId, user.id))
          .orderBy(desc(schema.automations.updatedAt)),
      );
    })
    .post("/v1/automations", automationBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      if (!body.name?.trim() || !body.trigger || !body.actions?.length) {
        return context.json({ error: "Name, trigger, and actions are required" as const }, 400);
      }
      const statuses = ["draft", "suggested", "active", "paused"] as const;
      const autonomyLevels = ["suggest", "approve", "auto"] as const;
      const [automation] = await database
        .insert(schema.automations)
        .values({
          id: randomUUID(),
          userId: user.id,
          name: body.name.trim(),
          description: body.description,
          status:
            body.status && inArrayValue(statuses, body.status) ? body.status : ("draft" as const),
          trigger: body.trigger as AutomationTrigger,
          conditions: (body.conditions ?? []) as AutomationCondition[],
          actions: body.actions.map((action) => ({
            id: action.id ?? randomUUID(),
            type: (action.type ?? "notify") as AutomationAction["type"],
            config: action.config ?? {},
            ...(action.modelOverride ? { modelOverride: action.modelOverride } : {}),
          })),
          autonomyLevel:
            body.autonomyLevel && inArrayValue(autonomyLevels, body.autonomyLevel)
              ? body.autonomyLevel
              : "approve",
          allowAutoExternal: body.allowAutoExternal ?? false,
          providerAccountId: body.providerAccountId,
          modelOverride: body.modelOverride,
        })
        .returning();
      return context.json(automation, 201);
    })
    .patch("/v1/automations/:id", automationBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      const statuses = ["draft", "suggested", "active", "paused"] as const;
      const autonomyLevels = ["suggest", "approve", "auto"] as const;
      const status = body.status && inArrayValue(statuses, body.status) ? body.status : undefined;
      const autonomyLevel =
        body.autonomyLevel && inArrayValue(autonomyLevels, body.autonomyLevel)
          ? body.autonomyLevel
          : undefined;
      const [automation] = await database
        .update(schema.automations)
        .set({
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(status ? { status: status as AutomationStatus } : {}),
          ...(body.trigger ? { trigger: body.trigger as AutomationTrigger } : {}),
          ...(body.conditions ? { conditions: body.conditions as AutomationCondition[] } : {}),
          ...(body.actions
            ? {
                actions: body.actions.map((action) => ({
                  id: action.id ?? randomUUID(),
                  type: (action.type ?? "notify") as AutomationAction["type"],
                  config: action.config ?? {},
                  ...(action.modelOverride ? { modelOverride: action.modelOverride } : {}),
                })),
              }
            : {}),
          ...(autonomyLevel ? { autonomyLevel: autonomyLevel as AutonomyLevel } : {}),
          ...(body.allowAutoExternal !== undefined
            ? { allowAutoExternal: body.allowAutoExternal }
            : {}),
          ...(body.providerAccountId !== undefined
            ? { providerAccountId: body.providerAccountId || null }
            : {}),
          ...(body.modelOverride !== undefined
            ? { modelOverride: body.modelOverride || null }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.automations.id, context.req.param("id")),
            eq(schema.automations.userId, user.id),
          ),
        )
        .returning();
      if (!automation) return context.json({ error: "Automation not found" as const }, 404);
      return context.json(automation);
    })
    .delete("/v1/automations/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.automations)
        .where(
          and(
            eq(schema.automations.id, context.req.param("id")),
            eq(schema.automations.userId, user.id),
          ),
        )
        .returning({ id: schema.automations.id });
      if (!deleted.length) return context.json({ error: "Automation not found" as const }, 404);
      return context.json({ deleted: true as const });
    })
    .post("/v1/automations/:id/run", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !enqueue) return context.json({ error: "Queue unavailable" as const }, 503);
      const [automation] = await database
        .select({ id: schema.automations.id })
        .from(schema.automations)
        .where(
          and(
            eq(schema.automations.id, context.req.param("id")),
            eq(schema.automations.userId, user.id),
          ),
        )
        .limit(1);
      if (!automation) return context.json({ error: "Automation not found" as const }, 404);
      const runId = randomUUID();
      await database.insert(schema.automationRuns).values({
        id: runId,
        userId: user.id,
        automationId: automation.id,
        triggerType: "manual",
      });
      const jobId = await enqueue(JOBS.runAutomation, {
        automationId: automation.id,
        runId,
        userId: user.id,
      });
      return context.json({ jobId, queued: true as const, runId }, 202);
    })
    .get("/v1/automation-runs", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.automationRuns)
          .where(eq(schema.automationRuns.userId, user.id))
          .orderBy(desc(schema.automationRuns.createdAt))
          .limit(100),
      );
    })
    .get("/v1/suggestions", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.automations)
          .where(
            and(eq(schema.automations.userId, user.id), eq(schema.automations.status, "suggested")),
          )
          .orderBy(desc(schema.automations.createdAt)),
      );
    })
    .post("/v1/suggestions/:id/accept", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [automation] = await database
        .update(schema.automations)
        .set({ status: "active", updatedAt: new Date() })
        .where(
          and(
            eq(schema.automations.id, context.req.param("id")),
            eq(schema.automations.userId, user.id),
            eq(schema.automations.status, "suggested"),
          ),
        )
        .returning();
      if (!automation) return context.json({ error: "Suggestion not found" as const }, 404);
      return context.json(automation);
    })
    .get("/v1/approvals", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.approvals)
          .where(eq(schema.approvals.userId, user.id))
          .orderBy(desc(schema.approvals.createdAt))
          .limit(100),
      );
    })
    .post("/v1/approvals/:id/approve", approvalBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !enqueue) return context.json({ error: "Queue unavailable" as const }, 503);
      const [approval] = await database
        .update(schema.approvals)
        .set({
          status: "approved",
          editedPayload: context.req.valid("json").editedPayload,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(schema.approvals.id, context.req.param("id")),
            eq(schema.approvals.userId, user.id),
            eq(schema.approvals.status, "pending"),
            gt(schema.approvals.expiresAt, new Date()),
          ),
        )
        .returning({ id: schema.approvals.id });
      if (!approval) return context.json({ error: "Approval is unavailable or expired" }, 409);
      const jobId = await enqueue(JOBS.executeApproval, {
        approvalId: approval.id,
        userId: user.id,
      });
      return context.json({ jobId, queued: true as const }, 202);
    })
    .post("/v1/approvals/:id/reject", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [approval] = await database
        .update(schema.approvals)
        .set({ status: "rejected", decidedAt: new Date() })
        .where(
          and(
            eq(schema.approvals.id, context.req.param("id")),
            eq(schema.approvals.userId, user.id),
            eq(schema.approvals.status, "pending"),
          ),
        )
        .returning();
      if (!approval) return context.json({ error: "Approval not found" as const }, 404);
      return context.json(approval);
    })
    .get("/v1/mcp-servers", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select({
            id: schema.mcpServers.id,
            name: schema.mcpServers.name,
            transport: schema.mcpServers.transport,
            url: schema.mcpServers.url,
            command: schema.mcpServers.command,
            enabled: schema.mcpServers.enabled,
            lastError: schema.mcpServers.lastError,
          })
          .from(schema.mcpServers)
          .where(eq(schema.mcpServers.userId, user.id)),
      );
    })
    .post("/v1/mcp-servers", mcpBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database || !credentialEncryptionKey) {
        return context.json({ error: "Credential storage unavailable" as const }, 503);
      }
      const body = context.req.valid("json");
      if (!body.name?.trim() || !body.transport) {
        return context.json({ error: "MCP name and transport are required" }, 400);
      }
      const [server] = await database
        .insert(schema.mcpServers)
        .values({
          id: randomUUID(),
          userId: user.id,
          name: body.name.trim(),
          transport: body.transport,
          url: body.url,
          command: body.command,
          enabled: body.enabled ?? true,
          encryptedConfig: body.config
            ? await encryptCredential(JSON.stringify(body.config), credentialEncryptionKey)
            : undefined,
        })
        .returning({
          id: schema.mcpServers.id,
          name: schema.mcpServers.name,
          transport: schema.mcpServers.transport,
          url: schema.mcpServers.url,
          command: schema.mcpServers.command,
          enabled: schema.mcpServers.enabled,
        });
      return context.json(server, 201);
    })
    .delete("/v1/mcp-servers/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.mcpServers)
        .where(
          and(
            eq(schema.mcpServers.id, context.req.param("id")),
            eq(schema.mcpServers.userId, user.id),
          ),
        )
        .returning({ id: schema.mcpServers.id });
      if (!deleted.length) return context.json({ error: "MCP server not found" as const }, 404);
      return context.json({ deleted: true as const });
    })
    .get("/v1/plugins", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.plugins)
          .where(eq(schema.plugins.userId, user.id))
          .orderBy(asc(schema.plugins.name)),
      );
    })
    .post("/v1/plugins", pluginBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const body = context.req.valid("json");
      const command = body.slashCommand?.trim().replace(/^\//, "");
      if (!body.name?.trim() || !command || !body.instructions?.trim()) {
        return context.json(
          { error: "Plugin name, slash command, and instructions are required" },
          400,
        );
      }
      const [plugin] = await database
        .insert(schema.plugins)
        .values({
          id: randomUUID(),
          userId: user.id,
          name: body.name.trim(),
          slashCommand: command,
          description: body.description,
          instructions: body.instructions.trim(),
          enabled: body.enabled ?? true,
        })
        .returning();
      return context.json(plugin, 201);
    })
    .delete("/v1/plugins/:id", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const deleted = await database
        .delete(schema.plugins)
        .where(
          and(eq(schema.plugins.id, context.req.param("id")), eq(schema.plugins.userId, user.id)),
        )
        .returning({ id: schema.plugins.id });
      if (!deleted.length) return context.json({ error: "Plugin not found" as const }, 404);
      return context.json({ deleted: true as const });
    })
    .get("/v1/plans", async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      return context.json(
        await database
          .select()
          .from(schema.planArtifacts)
          .where(eq(schema.planArtifacts.userId, user.id))
          .orderBy(desc(schema.planArtifacts.updatedAt)),
      );
    })
    .post("/v1/plans/:id/fork", forkPlanBody, async (context) => {
      const user = context.get("user");
      if (!user) return context.json({ error: "Unauthorized" as const }, 401);
      if (!database) return context.json({ error: "Database unavailable" as const }, 503);
      const [plan] = await database
        .select()
        .from(schema.planArtifacts)
        .where(
          and(
            eq(schema.planArtifacts.id, context.req.param("id")),
            eq(schema.planArtifacts.userId, user.id),
          ),
        )
        .limit(1);
      if (!plan) return context.json({ error: "Plan not found" as const }, 404);
      const body = context.req.valid("json");
      const mode = body.mode === "plan" || body.mode === "auto" ? body.mode : "ask";
      const sessionId = randomUUID();
      await database.insert(schema.agentSessions).values({
        id: sessionId,
        userId: user.id,
        title: body.title?.trim() || `Execute: ${plan.title}`,
        kind: "chat",
        backend: body.backend === "local" ? "local" : "hosted",
        mode,
        effort: body.effort ?? "medium",
        providerAccountId: body.providerAccountId,
        modelOverride: body.modelOverride,
        enabledToolsets: ["items", "memory"],
        parentSessionId: plan.sessionId,
        sourcePlanId: plan.id,
      });
      await database.insert(schema.sessionEvents).values({
        id: randomUUID(),
        userId: user.id,
        sessionId,
        sequence: 1,
        type: "message",
        role: "user",
        content: `Execute this approved plan:\n\n${plan.content}`,
        payload: { sourcePlanId: plan.id },
      });
      return context.json({ sessionId }, 201);
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
