import type { EventEmitter } from "node:events";

import { runHostedAgent } from "@home/agent";
import { createProviderModel, estimateCostUsd, findMemoryDuplicate, resolveModel } from "@home/ai";
import { decryptCredential, getConnector } from "@home/connectors";
import {
  type DistillSessionJob,
  type ExecuteItemActionJob,
  JOBS,
  type RunSessionJob,
  rankTriageItem,
  type SyncConnectionJob,
} from "@home/core";
import { getDatabase, schema } from "@home/db";
import { type ModelMessage, tool } from "ai";
import { and, asc, desc, eq, ilike, isNull, max, or, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { z } from "zod";

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

async function nextSessionSequence(sessionId: string) {
  const rows = await database
    .select({ sequence: max(schema.sessionEvents.sequence) })
    .from(schema.sessionEvents)
    .where(eq(schema.sessionEvents.sessionId, sessionId));
  return (rows[0]?.sequence ?? 0) + 1;
}

function jsonPayload(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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

await boss.work<RunSessionJob>(JOBS.runSession, async (jobs) => {
  for (const job of jobs) {
    const [session] = await database
      .select()
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.id, job.data.sessionId),
          eq(schema.agentSessions.userId, job.data.userId),
        ),
      )
      .limit(1);
    const [run] = await database
      .select()
      .from(schema.sessionRuns)
      .where(
        and(
          eq(schema.sessionRuns.id, job.data.runId),
          eq(schema.sessionRuns.userId, job.data.userId),
        ),
      )
      .limit(1);
    if (!session || !run || run.status === "completed") continue;

    await database
      .update(schema.agentSessions)
      .set({ status: "running", lastError: null, updatedAt: new Date() })
      .where(eq(schema.agentSessions.id, session.id));
    await database
      .update(schema.sessionRuns)
      .set({ status: "running", startedAt: new Date(), error: null })
      .where(eq(schema.sessionRuns.id, run.id));

    try {
      const accounts = await database
        .select()
        .from(schema.providerAccounts)
        .where(eq(schema.providerAccounts.userId, session.userId));
      const preferences = await database
        .select()
        .from(schema.modelPreferences)
        .where(eq(schema.modelPreferences.userId, session.userId));
      const resolution = resolveModel({
        accounts: accounts.map((account) => ({
          id: account.id,
          provider: account.provider,
          status: account.status,
        })),
        callSite: {
          providerAccountId: session.providerAccountId ?? undefined,
          model: session.modelOverride ?? undefined,
        },
        preferences: preferences.map((preference) => ({
          purpose: preference.purpose,
          providerAccountId: preference.providerAccountId,
          model: preference.model,
        })),
        purpose: "chat",
      });
      const account = accounts.find((candidate) => candidate.id === resolution.account.id);
      if (!account) throw new Error("Resolved provider account is unavailable");
      const apiKey = await decryptCredential(account.encryptedCredential, credentialEncryptionKey);
      const model = createProviderModel({
        apiKey,
        model: resolution.model,
        provider: account.provider,
      });

      const events = await database
        .select({
          role: schema.sessionEvents.role,
          content: schema.sessionEvents.content,
        })
        .from(schema.sessionEvents)
        .where(
          and(
            eq(schema.sessionEvents.sessionId, session.id),
            eq(schema.sessionEvents.type, "message"),
          ),
        )
        .orderBy(asc(schema.sessionEvents.sequence))
        .limit(80);
      const memories = await database
        .select({ kind: schema.memories.kind, content: schema.memories.content })
        .from(schema.memories)
        .where(
          and(eq(schema.memories.userId, session.userId), isNull(schema.memories.supersededAt)),
        )
        .orderBy(desc(schema.memories.updatedAt))
        .limit(20);

      const conversation: ModelMessage[] = events
        .filter(
          (event): event is { role: "user" | "assistant"; content: string } =>
            (event.role === "user" || event.role === "assistant") && Boolean(event.content),
        )
        .map((event) => ({ role: event.role, content: event.content }));
      if (memories.length) {
        conversation.unshift({
          role: "user",
          content: `Background memory (do not repeat unless relevant):\n${memories
            .map((memory) => `- [${memory.kind}] ${memory.content}`)
            .join("\n")}`,
        });
      }

      const tools = {
        search_items: tool({
          description: "Search the user's connected Gmail, Slack, and Linear work items.",
          inputSchema: z.object({ query: z.string().min(1), limit: z.number().min(1).max(20) }),
          execute: async ({ query, limit }) =>
            database
              .select({
                id: schema.items.id,
                provider: schema.items.provider,
                title: schema.items.title,
                preview: schema.items.preview,
                status: schema.items.status,
                occurredAt: schema.items.occurredAt,
                externalUrl: schema.items.externalUrl,
              })
              .from(schema.items)
              .where(
                and(
                  eq(schema.items.userId, session.userId),
                  or(
                    ilike(schema.items.title, `%${query}%`),
                    ilike(schema.items.body, `%${query}%`),
                  ),
                ),
              )
              .orderBy(desc(schema.items.occurredAt))
              .limit(limit),
        }),
        search_memories: tool({
          description: "Search facts, preferences, people, and projects remembered about the user.",
          inputSchema: z.object({ query: z.string().min(1), limit: z.number().min(1).max(20) }),
          execute: async ({ query, limit }) =>
            database
              .select({
                id: schema.memories.id,
                kind: schema.memories.kind,
                content: schema.memories.content,
                confidence: schema.memories.confidence,
              })
              .from(schema.memories)
              .where(
                and(
                  eq(schema.memories.userId, session.userId),
                  isNull(schema.memories.supersededAt),
                  ilike(schema.memories.content, `%${query}%`),
                ),
              )
              .orderBy(desc(schema.memories.updatedAt))
              .limit(limit),
        }),
        ...(session.mode === "auto"
          ? {
              write_memory: tool({
                description: "Save a durable fact or preference when the user explicitly asks.",
                inputSchema: z.object({
                  kind: z.enum(["fact", "preference", "person", "project"]),
                  content: z.string().min(3),
                }),
                execute: async ({ kind, content }) => {
                  const id = crypto.randomUUID();
                  await database.insert(schema.memories).values({
                    id,
                    userId: session.userId,
                    kind,
                    content,
                    source: "agent",
                    sourceId: session.id,
                    confidence: 0.9,
                  });
                  return { id, saved: true };
                },
              }),
            }
          : {}),
      };

      const result = await runHostedAgent({
        effort: session.effort,
        messages: conversation,
        mode: session.mode,
        model,
        tools,
      });

      let sequence = await nextSessionSequence(session.id);
      for (const step of result.steps) {
        for (const toolCall of step.toolCalls) {
          await database.insert(schema.sessionEvents).values({
            id: crypto.randomUUID(),
            userId: session.userId,
            sessionId: session.id,
            sequence,
            type: "tool_call",
            model: resolution.model,
            payload: jsonPayload(toolCall),
          });
          sequence += 1;
        }
        for (const toolResult of step.toolResults) {
          await database.insert(schema.sessionEvents).values({
            id: crypto.randomUUID(),
            userId: session.userId,
            sessionId: session.id,
            sequence,
            type: "tool_result",
            model: resolution.model,
            payload: jsonPayload(toolResult),
          });
          sequence += 1;
        }
      }
      const outputEventId = crypto.randomUUID();
      await database.insert(schema.sessionEvents).values({
        id: outputEventId,
        userId: session.userId,
        sessionId: session.id,
        sequence,
        type: "message",
        role: "assistant",
        content: result.text || "I completed the run without a text response.",
        model: resolution.model,
      });
      const inputTokens = result.totalUsage.inputTokens ?? 0;
      const outputTokens = result.totalUsage.outputTokens ?? 0;
      await database.insert(schema.usageLogs).values({
        id: crypto.randomUUID(),
        userId: session.userId,
        providerAccountId: account.id,
        sessionId: session.id,
        provider: account.provider,
        model: resolution.model,
        purpose: "chat",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimateCostUsd({
          inputTokens,
          outputTokens,
          provider: account.provider,
        }),
        substitutionReason: resolution.substitutionReason,
      });
      await database
        .update(schema.sessionRuns)
        .set({
          status: "completed",
          outputEventId,
          completedAt: new Date(),
          error: null,
        })
        .where(eq(schema.sessionRuns.id, run.id));
      await database
        .update(schema.agentSessions)
        .set({
          status: "idle",
          providerAccountId: account.id,
          modelOverride: resolution.model,
          lastActivityAt: new Date(),
          lastError: null,
        })
        .where(eq(schema.agentSessions.id, session.id));
      await boss.send(JOBS.distillSession, {
        sessionId: session.id,
        userId: session.userId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent run failed";
      await database
        .update(schema.sessionRuns)
        .set({ status: "failed", error: message, completedAt: new Date() })
        .where(eq(schema.sessionRuns.id, run.id));
      await database
        .update(schema.agentSessions)
        .set({ status: "failed", lastError: message, updatedAt: new Date() })
        .where(eq(schema.agentSessions.id, session.id));
      throw error;
    }
  }
});

await boss.work<DistillSessionJob>(JOBS.distillSession, async (jobs) => {
  for (const job of jobs) {
    const messages = await database
      .select({ content: schema.sessionEvents.content })
      .from(schema.sessionEvents)
      .where(
        and(
          eq(schema.sessionEvents.sessionId, job.data.sessionId),
          eq(schema.sessionEvents.userId, job.data.userId),
          eq(schema.sessionEvents.role, "user"),
        ),
      )
      .orderBy(desc(schema.sessionEvents.sequence))
      .limit(20);
    const existing = await database
      .select({ content: schema.memories.content, kind: schema.memories.kind })
      .from(schema.memories)
      .where(
        and(eq(schema.memories.userId, job.data.userId), isNull(schema.memories.supersededAt)),
      );

    for (const message of messages) {
      for (const sentence of (message.content ?? "").split(/[.!?]\s+/)) {
        const content = sentence.trim();
        const lower = content.toLowerCase();
        const kind = lower.includes("i prefer")
          ? ("preference" as const)
          : lower.includes("my project") || lower.includes("i'm building")
            ? ("project" as const)
            : lower.includes("i work with")
              ? ("person" as const)
              : undefined;
        if (!kind || content.length < 12 || content.length > 280) continue;
        const candidate = { content, kind };
        if (findMemoryDuplicate(candidate, existing)) continue;
        await database.insert(schema.memories).values({
          id: crypto.randomUUID(),
          userId: job.data.userId,
          kind,
          content,
          source: "session_distillation",
          sourceId: job.data.sessionId,
          confidence: 0.72,
        });
        existing.push(candidate);
      }
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
