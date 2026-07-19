import { createHash, randomBytes, randomUUID } from "node:crypto";

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
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
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
