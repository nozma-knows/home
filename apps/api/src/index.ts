import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";

import { createApi } from "@home/api";
import { auth } from "@home/auth";
import { JOBS } from "@home/core";
import { getDatabase, schema } from "@home/db";
import { and, eq, gt, max } from "drizzle-orm";
import { PgBoss } from "pg-boss";

type SocketData = { queue: Promise<void>; tokenId: string; userId: string };
type SidecarMessage = {
  type?: string;
  sessionId?: string;
  runId?: string;
  eventType?: string;
  role?: string;
  content?: string;
  command?: string;
  workingDirectory?: string;
  requestId?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

const port = Number(process.env.PORT ?? process.env.HOME_API_PORT ?? 3001);
const trustedOrigins = [
  process.env.WEB_URL ?? "http://localhost:3000",
  ...(process.env.ADDITIONAL_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = getDatabase();
const sidecars = new Map<string, Set<Bun.ServerWebSocket<SocketData>>>();

function dispatchSidecar(userId: string, payload: Record<string, unknown>) {
  const sockets = sidecars.get(userId);
  if (!sockets?.size) return false;
  const message = JSON.stringify(payload);
  let delivered = false;
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      delivered = true;
    }
  }
  return delivered;
}

async function appendSidecarEvent(data: SocketData, message: SidecarMessage) {
  if (!message.sessionId || !message.runId || !message.eventType) return;
  const [run] = await database
    .select({ id: schema.sessionRuns.id })
    .from(schema.sessionRuns)
    .where(
      and(
        eq(schema.sessionRuns.id, message.runId),
        eq(schema.sessionRuns.sessionId, message.sessionId),
        eq(schema.sessionRuns.userId, data.userId),
      ),
    )
    .limit(1);
  if (!run) return;
  const [session] = await database
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.id, message.sessionId),
        eq(schema.agentSessions.userId, data.userId),
      ),
    )
    .limit(1);
  if (!session) return;
  const rows = await database
    .select({ sequence: max(schema.sessionEvents.sequence) })
    .from(schema.sessionEvents)
    .where(eq(schema.sessionEvents.sessionId, session.id));
  await database.insert(schema.sessionEvents).values({
    id: crypto.randomUUID(),
    userId: data.userId,
    sessionId: session.id,
    sequence: (rows[0]?.sequence ?? 0) + 1,
    type: message.eventType,
    role: message.role,
    content: message.content,
    payload: message.payload ?? {},
  });
}

async function handleSidecarMessage(data: SocketData, message: SidecarMessage) {
  if (message.type === "event") {
    await appendSidecarEvent(data, message);
    return;
  }
  if (message.type === "permission_request") {
    if (
      !message.sessionId ||
      !message.runId ||
      !message.requestId ||
      !message.command ||
      !message.workingDirectory
    ) {
      return;
    }
    const [run] = await database
      .select({ id: schema.sessionRuns.id })
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.id, message.runId),
          eq(schema.sessionRuns.sessionId, message.sessionId),
          eq(schema.sessionRuns.userId, data.userId),
        ),
      )
      .limit(1);
    if (!run) return;
    await database.insert(schema.sessionPermissions).values({
      id: message.requestId,
      userId: data.userId,
      sessionId: message.sessionId,
      runId: message.runId,
      command: message.command,
      workingDirectory: message.workingDirectory,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    await appendSidecarEvent(data, {
      sessionId: message.sessionId,
      runId: message.runId,
      eventType: "permission_prompt",
      content: message.command,
      payload: {
        requestId: message.requestId,
        command: message.command,
        workingDirectory: message.workingDirectory,
      },
    });
    await database
      .update(schema.agentSessions)
      .set({ status: "waiting", updatedAt: new Date() })
      .where(
        and(
          eq(schema.agentSessions.id, message.sessionId),
          eq(schema.agentSessions.userId, data.userId),
        ),
      );
    return;
  }
  if (message.type === "status" && message.sessionId && message.runId) {
    const [run] = await database
      .select({ id: schema.sessionRuns.id })
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.id, message.runId),
          eq(schema.sessionRuns.sessionId, message.sessionId),
          eq(schema.sessionRuns.userId, data.userId),
        ),
      )
      .limit(1);
    if (!run) return;
    const status = message.status;
    if (status === "running") {
      await database
        .update(schema.sessionRuns)
        .set({ status: "running", startedAt: new Date(), error: null })
        .where(
          and(eq(schema.sessionRuns.id, message.runId), eq(schema.sessionRuns.userId, data.userId)),
        );
      await database
        .update(schema.agentSessions)
        .set({ status: "running", lastError: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.agentSessions.id, message.sessionId),
            eq(schema.agentSessions.userId, data.userId),
          ),
        );
    } else if (status === "completed" || status === "failed") {
      const error = status === "failed" ? (message.content ?? "Local run failed") : null;
      await database
        .update(schema.sessionRuns)
        .set({ status, error, completedAt: new Date() })
        .where(
          and(eq(schema.sessionRuns.id, message.runId), eq(schema.sessionRuns.userId, data.userId)),
        );
      await database
        .update(schema.agentSessions)
        .set({
          status: status === "completed" ? "idle" : "failed",
          lastError: error,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.agentSessions.id, message.sessionId),
            eq(schema.agentSessions.userId, data.userId),
          ),
        );
    }
  }
}

const boss = new PgBoss({ connectionString: databaseUrl, application_name: "home-api" });
(boss as unknown as EventEmitter).on("error", (error: Error) => {
  console.error("pg-boss error", error);
});
await boss.start();
for (const name of Object.values(JOBS)) {
  await boss.createQueue(name, { retryLimit: 5, retryBackoff: true, retryDelay: 15 });
}

const app = createApi({
  auth,
  database,
  dispatchSidecar,
  enqueue: (name, data) => boss.send(name, data),
  isSidecarConnected: (userId) => Boolean(sidecars.get(userId)?.size),
  trustedOrigins,
});

const server = Bun.serve<SocketData>({
  port,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/sidecars/socket") {
      const token = url.searchParams.get("token");
      if (!token) return new Response("Missing sidecar token", { status: 401 });
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const [record] = await database
        .select()
        .from(schema.sidecarTokens)
        .where(
          and(
            eq(schema.sidecarTokens.tokenHash, tokenHash),
            gt(schema.sidecarTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!record) return new Response("Invalid sidecar token", { status: 401 });
      await database
        .update(schema.sidecarTokens)
        .set({ lastConnectedAt: new Date() })
        .where(eq(schema.sidecarTokens.id, record.id));
      if (
        server.upgrade(request, {
          data: { queue: Promise.resolve(), tokenId: record.id, userId: record.userId },
        })
      ) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(request);
  },
  websocket: {
    open(socket) {
      const sockets = sidecars.get(socket.data.userId) ?? new Set();
      sockets.add(socket);
      sidecars.set(socket.data.userId, sockets);
      socket.send(JSON.stringify({ type: "connected" }));
    },
    message(socket, rawMessage) {
      try {
        const message = JSON.parse(String(rawMessage)) as SidecarMessage;
        socket.data.queue = socket.data.queue
          .then(() => handleSidecarMessage(socket.data, message))
          .catch((error) => console.error("sidecar message failed", error));
      } catch (error) {
        console.error("invalid sidecar message", error);
      }
    },
    close(socket) {
      const sockets = sidecars.get(socket.data.userId);
      sockets?.delete(socket);
      if (!sockets?.size) sidecars.delete(socket.data.userId);
    },
  },
});

console.log(`home api listening on ${server.url}`);

async function stop(signal: string) {
  console.log(`home api received ${signal}; stopping`);
  server.stop(true);
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
