import type { EventEmitter } from "node:events";

import { decryptCredential, getConnector } from "@home/connectors";
import {
  type ExecuteItemActionJob,
  JOBS,
  rankTriageItem,
  type SyncConnectionJob,
} from "@home/core";
import { getDatabase, schema } from "@home/db";
import { and, eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const credentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
if (!credentialEncryptionKey) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required");

const workerName = process.env.WORKER_NAME ?? "home-worker";
const database = getDatabase();
const boss = new PgBoss({
  connectionString: databaseUrl,
  application_name: workerName,
});

(boss as unknown as EventEmitter).on("error", (error: Error) => {
  console.error("pg-boss error", error);
});

await boss.start();
for (const name of Object.values(JOBS)) {
  await boss.createQueue(name, { retryLimit: 5, retryBackoff: true, retryDelay: 15 });
}

await boss.work<SyncConnectionJob>(JOBS.syncConnection, async (jobs) => {
  for (const job of jobs) {
    const [connection] = await database
      .select()
      .from(schema.connections)
      .where(
        and(
          eq(schema.connections.id, job.data.connectionId),
          eq(schema.connections.userId, job.data.userId),
        ),
      )
      .limit(1);
    if (!connection || connection.status === "disconnected") continue;

    try {
      const connector = getConnector(connection.provider);
      const accessToken = await decryptCredential(
        connection.encryptedAccessToken,
        credentialEncryptionKey,
      );
      const result = await connector.sync({
        accessToken,
        cursor: connection.cursor,
        metadata: connection.metadata,
      });

      for (const item of result.items) {
        const ageHours = Math.max(0, (Date.now() - item.occurredAt.getTime()) / 3_600_000);
        const urgencyScore = rankTriageItem({
          ageHours,
          isAssigned: item.isAssigned,
          isDirectMention: item.isDirectMention,
          isRead: item.isRead,
          provider: connection.provider,
        });
        await database
          .insert(schema.items)
          .values({
            id: crypto.randomUUID(),
            userId: connection.userId,
            organizationId: connection.organizationId,
            connectionId: connection.id,
            provider: connection.provider,
            externalId: item.externalId,
            threadId: item.threadId,
            type: item.type,
            title: item.title,
            body: item.body,
            preview: item.preview,
            participants: item.participants,
            externalUrl: item.externalUrl,
            isRead: item.isRead,
            isDirectMention: item.isDirectMention,
            isAssigned: item.isAssigned,
            urgencyScore,
            occurredAt: item.occurredAt,
            raw: item.raw,
          })
          .onConflictDoUpdate({
            target: [schema.items.connectionId, schema.items.externalId],
            set: {
              threadId: item.threadId,
              title: item.title,
              body: item.body,
              preview: item.preview,
              participants: item.participants,
              externalUrl: item.externalUrl,
              isRead: item.isRead,
              isDirectMention: item.isDirectMention,
              isAssigned: item.isAssigned,
              urgencyScore,
              occurredAt: item.occurredAt,
              raw: item.raw,
              updatedAt: new Date(),
            },
          });
      }

      await database
        .update(schema.connections)
        .set({
          cursor: result.cursor,
          lastSyncedAt: new Date(),
          lastError: null,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(schema.connections.id, connection.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connector sync failed";
      await database
        .update(schema.connections)
        .set({ lastError: message, updatedAt: new Date() })
        .where(eq(schema.connections.id, connection.id));
      throw error;
    }
  }
});

await boss.work<ExecuteItemActionJob>(JOBS.executeItemAction, async (jobs) => {
  for (const job of jobs) {
    const [request] = await database
      .select({
        request: schema.itemActionRequests,
        item: schema.items,
        connection: schema.connections,
      })
      .from(schema.itemActionRequests)
      .innerJoin(schema.items, eq(schema.itemActionRequests.itemId, schema.items.id))
      .innerJoin(schema.connections, eq(schema.items.connectionId, schema.connections.id))
      .where(
        and(
          eq(schema.itemActionRequests.id, job.data.requestId),
          eq(schema.itemActionRequests.userId, job.data.userId),
        ),
      )
      .limit(1);
    if (!request || request.request.status === "completed") continue;

    try {
      const connector = getConnector(request.connection.provider);
      const accessToken = await decryptCredential(
        request.connection.encryptedAccessToken,
        credentialEncryptionKey,
      );
      const output = await connector.executeAction(
        request.request.action,
        {
          ...request.request.input,
          externalId: request.item.externalId,
          messageId: request.item.externalId,
          threadId: request.item.threadId,
          ...(request.item.raw.channelId ? { channelId: request.item.raw.channelId } : {}),
          ...(request.item.provider === "linear" ? { issueId: request.item.externalId } : {}),
        },
        {
          accessToken,
          cursor: request.connection.cursor,
          metadata: request.connection.metadata,
        },
      );
      await database
        .update(schema.itemActionRequests)
        .set({ status: "completed", output, completedAt: new Date(), error: null })
        .where(eq(schema.itemActionRequests.id, request.request.id));

      if (["archive", "reply", "comment"].includes(request.request.action)) {
        await database
          .update(schema.items)
          .set({ status: request.request.action === "archive" ? "archived" : "done" })
          .where(eq(schema.items.id, request.item.id));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connector action failed";
      await database
        .update(schema.itemActionRequests)
        .set({
          status: "failed",
          error: message,
          attempts: sql`${schema.itemActionRequests.attempts} + 1`,
        })
        .where(eq(schema.itemActionRequests.id, request.request.id));
      throw error;
    }
  }
});

await boss.work(JOBS.syncConnections, async () => {
  const activeConnections = await database
    .select({ id: schema.connections.id, userId: schema.connections.userId })
    .from(schema.connections)
    .where(eq(schema.connections.status, "active"));
  for (const connection of activeConnections) {
    await boss.send(
      JOBS.syncConnection,
      { connectionId: connection.id, userId: connection.userId },
      { singletonKey: connection.id, singletonSeconds: 60 },
    );
  }
});

await boss.schedule(JOBS.syncConnections, "*/2 * * * *");
console.log(`${workerName} started with connector sync workers`);

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${workerName} received ${signal}; stopping`);
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
