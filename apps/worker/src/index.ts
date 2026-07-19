import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";

import { runHostedAgent } from "@home/agent";
import { createProviderModel, estimateCostUsd, findMemoryDuplicate, resolveModel } from "@home/ai";
import {
  decryptCredential,
  encryptCredential,
  fetchFeed,
  getConnector,
  getConnectorCredentials,
} from "@home/connectors";
import {
  type DistillSessionJob,
  type EvaluateAutomationEventJob,
  type ExecuteApprovalJob,
  type ExecuteItemActionJob,
  type GenerateBriefingJob,
  JOBS,
  matchesConditions,
  type RunAutomationJob,
  type RunSessionJob,
  rankTriageItem,
  requiresApproval,
  type SyncConnectionJob,
  type SyncFeedJob,
} from "@home/core";
import { getDatabase, schema } from "@home/db";
import { type ModelMessage, tool } from "ai";
import { and, asc, desc, eq, ilike, isNull, max, ne, or, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { z } from "zod";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const credentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "";
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

async function connectionAccessToken(connection: typeof schema.connections.$inferSelect) {
  const currentToken = await decryptCredential(
    connection.encryptedAccessToken,
    credentialEncryptionKey,
  );
  if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return currentToken;
  }

  const connector = getConnector(connection.provider);
  const credentials = getConnectorCredentials(connection.provider);
  if (!connection.encryptedRefreshToken || !connector.refreshAccessToken || !credentials) {
    await database
      .update(schema.connections)
      .set({
        status: "needs_reattention",
        lastError: "Connection credentials expired; reconnect this provider",
        updatedAt: new Date(),
      })
      .where(eq(schema.connections.id, connection.id));
    throw new Error("Connection credentials expired; reconnect this provider");
  }

  const refreshToken = await decryptCredential(
    connection.encryptedRefreshToken,
    credentialEncryptionKey,
  );
  const refreshed = await connector.refreshAccessToken({ ...credentials, refreshToken });
  await database
    .update(schema.connections)
    .set({
      encryptedAccessToken: await encryptCredential(refreshed.accessToken, credentialEncryptionKey),
      ...(refreshed.refreshToken
        ? {
            encryptedRefreshToken: await encryptCredential(
              refreshed.refreshToken,
              credentialEncryptionKey,
            ),
          }
        : {}),
      tokenExpiresAt: refreshed.expiresAt,
      status: "active",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.connections.id, connection.id));
  return refreshed.accessToken;
}

function gmailReplyMetadata(raw: Record<string, unknown>) {
  const payload = raw.payload;
  if (!payload || typeof payload !== "object") return {};
  const headers = (payload as { headers?: unknown }).headers;
  if (!Array.isArray(headers)) return {};
  const values = new Map<string, string>();
  for (const entry of headers) {
    if (!entry || typeof entry !== "object") continue;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (typeof name === "string" && typeof value === "string") {
      values.set(name.toLowerCase(), value);
    }
  }
  const originalSubject = values.get("subject") ?? "home triage";
  return {
    ...(values.get("from") ? { to: values.get("from") } : {}),
    subject: /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`,
  };
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
      const accessToken = await connectionAccessToken(connection);
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
        const [storedItem] = await database
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
          })
          .returning({ id: schema.items.id });
        if (storedItem) {
          const minute = new Date().toISOString().slice(0, 16);
          await boss.send(
            JOBS.evaluateAutomationEvent,
            { event: "item.created", itemId: storedItem.id, userId: connection.userId },
            {
              singletonKey: `${connection.id}:${item.externalId}:${minute}`,
              singletonSeconds: 60,
            },
          );
        }
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
      const accessToken = await connectionAccessToken(request.connection);
      const output = await connector.executeAction(
        request.request.action,
        {
          ...request.request.input,
          externalId: request.item.externalId,
          messageId: request.item.externalId,
          threadId: request.item.threadId,
          ...(request.item.raw.channelId ? { channelId: request.item.raw.channelId } : {}),
          ...(request.item.provider === "gmail" ? gmailReplyMetadata(request.item.raw) : {}),
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
      const lastUserMessage = [...events].reverse().find((event) => event.role === "user")?.content;
      const slashCommand = lastUserMessage?.match(/^\/([a-z0-9_-]+)/i)?.[1];
      if (slashCommand) {
        const [plugin] = await database
          .select({ name: schema.plugins.name, instructions: schema.plugins.instructions })
          .from(schema.plugins)
          .where(
            and(
              eq(schema.plugins.userId, session.userId),
              eq(schema.plugins.slashCommand, slashCommand),
              eq(schema.plugins.enabled, true),
            ),
          )
          .limit(1);
        if (plugin) {
          conversation.unshift({
            role: "user",
            content: `Active skill: ${plugin.name}\nFollow these instructions for this run:\n${plugin.instructions}`,
          });
        }
      }
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
      if (session.mode === "plan") {
        const planId = crypto.randomUUID();
        await database.insert(schema.planArtifacts).values({
          id: planId,
          userId: session.userId,
          sessionId: session.id,
          title: session.title,
          content: result.text || "No plan content was produced.",
        });
        await database.insert(schema.sessionEvents).values({
          id: crypto.randomUUID(),
          userId: session.userId,
          sessionId: session.id,
          sequence: sequence + 1,
          type: "plan",
          role: "assistant",
          content: result.text || "No plan content was produced.",
          model: resolution.model,
          payload: { planId },
        });
      }
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

await boss.work<SyncFeedJob>(JOBS.syncFeed, async (jobs) => {
  for (const job of jobs) {
    const [feed] = await database
      .select()
      .from(schema.rssFeeds)
      .where(
        and(eq(schema.rssFeeds.id, job.data.feedId), eq(schema.rssFeeds.userId, job.data.userId)),
      )
      .limit(1);
    if (!feed?.active) continue;
    try {
      const parsed = await fetchFeed(feed.url);
      for (const entry of parsed.entries.slice(0, 100)) {
        const occurredAt = Number.isNaN(entry.occurredAt.getTime()) ? new Date() : entry.occurredAt;
        await database
          .insert(schema.items)
          .values({
            id: crypto.randomUUID(),
            userId: feed.userId,
            organizationId: feed.organizationId,
            rssFeedId: feed.id,
            provider: "rss",
            externalId: entry.externalId,
            type: "news",
            title: entry.title,
            body: entry.body,
            preview: entry.preview,
            participants: [parsed.title ?? feed.title],
            externalUrl: entry.externalUrl,
            isRead: false,
            urgencyScore: 0,
            occurredAt,
            raw: entry.raw,
          })
          .onConflictDoUpdate({
            target: [schema.items.rssFeedId, schema.items.externalId],
            set: {
              title: entry.title,
              body: entry.body,
              preview: entry.preview,
              externalUrl: entry.externalUrl,
              occurredAt,
              updatedAt: new Date(),
            },
          });
      }
      await database
        .update(schema.rssFeeds)
        .set({
          title: parsed.title ?? feed.title,
          lastSyncedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.rssFeeds.id, feed.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "RSS sync failed";
      await database
        .update(schema.rssFeeds)
        .set({ lastError: message, updatedAt: new Date() })
        .where(eq(schema.rssFeeds.id, feed.id));
      throw error;
    }
  }
});

await boss.work(JOBS.syncFeeds, async () => {
  const feeds = await database
    .select({ id: schema.rssFeeds.id, userId: schema.rssFeeds.userId })
    .from(schema.rssFeeds)
    .where(eq(schema.rssFeeds.active, true));
  for (const feed of feeds) {
    await boss.send(
      JOBS.syncFeed,
      { feedId: feed.id, userId: feed.userId },
      { singletonKey: feed.id, singletonSeconds: 300 },
    );
  }
});

function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function localHour(now: Date, timeZone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(now),
  );
}

type TavilyResult = { title?: string; url?: string; content?: string; published_date?: string };

async function searchTopic(topic: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: topic,
      topic: "news",
      days: 7,
      max_results: 3,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`News search returned HTTP ${response.status}`);
  const result = (await response.json()) as { results?: TavilyResult[] };
  return result.results ?? [];
}

await boss.work<GenerateBriefingJob>(JOBS.generateBriefing, async (jobs) => {
  for (const job of jobs) {
    let [preference] = await database
      .select()
      .from(schema.briefingPreferences)
      .where(eq(schema.briefingPreferences.userId, job.data.userId))
      .limit(1);
    if (!preference) {
      [preference] = await database
        .insert(schema.briefingPreferences)
        .values({ id: crypto.randomUUID(), userId: job.data.userId })
        .returning();
    }
    if (!preference?.enabled) continue;
    const today = localDate(new Date(), preference.timezone);
    if (!job.data.force && preference.lastGeneratedDate === today) continue;

    const topics = await database
      .select()
      .from(schema.newsTopics)
      .where(
        and(eq(schema.newsTopics.userId, job.data.userId), eq(schema.newsTopics.active, true)),
      );
    for (const topic of topics) {
      try {
        for (const result of await searchTopic(topic.topic)) {
          if (!result.url || !result.title) continue;
          const externalId = createHash("sha256").update(result.url).digest("hex");
          const [existing] = await database
            .select({ id: schema.items.id })
            .from(schema.items)
            .where(
              and(
                eq(schema.items.userId, job.data.userId),
                eq(schema.items.provider, "web"),
                eq(schema.items.externalId, externalId),
              ),
            )
            .limit(1);
          if (existing) continue;
          await database.insert(schema.items).values({
            id: crypto.randomUUID(),
            userId: job.data.userId,
            provider: "web",
            externalId,
            type: "news",
            title: result.title,
            body: result.content,
            preview: result.content?.slice(0, 280),
            participants: [topic.topic],
            externalUrl: result.url,
            occurredAt: result.published_date ? new Date(result.published_date) : new Date(),
            raw: { ...result, topic: topic.topic },
          });
        }
      } catch (error) {
        console.error(`News search failed for ${topic.topic}`, error);
      }
    }

    const openItems = await database
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.userId, job.data.userId),
          eq(schema.items.status, "open"),
          ne(schema.items.type, "news"),
        ),
      )
      .orderBy(desc(schema.items.urgencyScore), desc(schema.items.occurredAt))
      .limit(30);
    const newsItems = await database
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.userId, job.data.userId),
          eq(schema.items.status, "open"),
          eq(schema.items.type, "news"),
        ),
      )
      .orderBy(desc(schema.items.occurredAt))
      .limit(preference.newsLimit);

    const priorities = openItems.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      provider: item.provider,
      reason: item.isDirectMention
        ? "Directly mentions you"
        : item.isAssigned
          ? "Assigned to you"
          : "Recent high-priority work",
      ...(item.externalUrl ? { url: item.externalUrl } : {}),
    }));
    const waiting = openItems
      .filter((item) => !item.isRead && !priorities.some((priority) => priority.id === item.id))
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.title,
        provider: item.provider,
        ...(item.externalUrl ? { url: item.externalUrl } : {}),
      }));
    const blocking = openItems
      .filter((item) => item.provider === "linear" && item.isAssigned)
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.title,
        provider: item.provider,
        ...(item.externalUrl ? { url: item.externalUrl } : {}),
      }));
    const news = newsItems.map((item) => ({
      id: item.id,
      title: item.title,
      source: item.participants[0] ?? item.provider,
      why:
        item.provider === "web"
          ? `Matches your ${String(item.raw.topic ?? "news")} topic`
          : "From a feed you follow",
      ...(item.externalUrl ? { url: item.externalUrl } : {}),
    }));
    const headline = priorities.length
      ? `${priorities.length} priorities need your attention`
      : "You're clear to focus";
    const summary = `${openItems.length} open work items and ${news.length} relevant news stories.`;
    await database
      .insert(schema.briefings)
      .values({
        id: crypto.randomUUID(),
        userId: job.data.userId,
        localDate: today,
        headline,
        summary,
        sections: { priorities, waiting, blocking, approvals: [], news },
      })
      .onConflictDoUpdate({
        target: [schema.briefings.userId, schema.briefings.localDate],
        set: {
          headline,
          summary,
          sections: { priorities, waiting, blocking, approvals: [], news },
          generatedAt: new Date(),
          status: "ready",
        },
      });
    await database
      .update(schema.briefingPreferences)
      .set({ lastGeneratedDate: today, updatedAt: new Date() })
      .where(eq(schema.briefingPreferences.id, preference.id));
  }
});

await boss.work(JOBS.generateScheduledBriefings, async () => {
  const now = new Date();
  const preferences = await database
    .select()
    .from(schema.briefingPreferences)
    .where(eq(schema.briefingPreferences.enabled, true));
  for (const preference of preferences) {
    if (localHour(now, preference.timezone) !== preference.deliveryHour) continue;
    const today = localDate(now, preference.timezone);
    if (preference.lastGeneratedDate === today) continue;
    await boss.send(
      JOBS.generateBriefing,
      { userId: preference.userId },
      { singletonKey: `${preference.userId}:${today}`, singletonSeconds: 3600 },
    );
  }
});

async function executeAutomationAction(input: {
  action: { id: string; type: string; config: Record<string, unknown> };
  automationRunId: string;
  context: Record<string, unknown>;
  userId: string;
}) {
  if (input.action.type === "create_memory") {
    const content = String(
      input.action.config.content ?? input.context.summary ?? input.context.title ?? "",
    );
    const kindValue = String(input.action.config.kind ?? "fact");
    const kind = ["fact", "preference", "person", "project"].includes(kindValue)
      ? (kindValue as "fact" | "preference" | "person" | "project")
      : ("fact" as const);
    if (!content) throw new Error("Memory action requires content");
    const id = crypto.randomUUID();
    await database.insert(schema.memories).values({
      id,
      userId: input.userId,
      kind,
      content,
      source: "automation",
      sourceId: input.automationRunId,
      confidence: 0.85,
    });
    return { id, saved: true };
  }

  if (input.action.type === "connector_action") {
    const itemId = String(input.action.config.itemId ?? input.context.itemId ?? "");
    const action = String(input.action.config.action ?? "archive");
    if (!itemId) throw new Error("Connector automation action requires an item");
    const [item] = await database
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(and(eq(schema.items.id, itemId), eq(schema.items.userId, input.userId)))
      .limit(1);
    if (!item) throw new Error("Automation item was not found");
    const requestId = crypto.randomUUID();
    await database.insert(schema.itemActionRequests).values({
      id: requestId,
      userId: input.userId,
      itemId,
      action,
      input: {
        ...((input.action.config.input as Record<string, unknown> | undefined) ?? {}),
        automationRunId: input.automationRunId,
      },
    });
    await boss.send(JOBS.executeItemAction, { requestId, userId: input.userId });
    return { queued: true, requestId };
  }

  if (input.action.type === "llm") {
    return {
      deferred: true,
      instruction: String(input.action.config.instruction ?? "Process the automation context"),
      note: "LLM step is recorded for the next agent session",
    };
  }

  return {
    notified: true,
    message: String(
      input.action.config.message ??
        input.action.config.instruction ??
        input.context.title ??
        "Automation completed",
    ),
  };
}

await boss.work<RunAutomationJob>(JOBS.runAutomation, async (jobs) => {
  for (const job of jobs) {
    const [automation] = await database
      .select()
      .from(schema.automations)
      .where(
        and(
          eq(schema.automations.id, job.data.automationId),
          eq(schema.automations.userId, job.data.userId),
        ),
      )
      .limit(1);
    const [run] = await database
      .select()
      .from(schema.automationRuns)
      .where(
        and(
          eq(schema.automationRuns.id, job.data.runId),
          eq(schema.automationRuns.userId, job.data.userId),
        ),
      )
      .limit(1);
    if (!automation || !run || run.status === "completed") continue;
    await database
      .update(schema.automationRuns)
      .set({ status: "running", startedAt: new Date(), error: null })
      .where(eq(schema.automationRuns.id, run.id));

    try {
      const context = { ...run.input, ...(job.data.input ?? {}) };
      if (context.itemId) {
        const [item] = await database
          .select()
          .from(schema.items)
          .where(
            and(
              eq(schema.items.id, String(context.itemId)),
              eq(schema.items.userId, automation.userId),
            ),
          )
          .limit(1);
        if (item) {
          Object.assign(context, {
            provider: item.provider,
            sender: item.participants[0],
            title: item.title,
            body: item.body,
            isAssigned: item.isAssigned,
            isDirectMention: item.isDirectMention,
          });
        }
      }
      if (!matchesConditions(context, automation.conditions)) {
        await database
          .update(schema.automationRuns)
          .set({
            status: "skipped",
            stepOutputs: [{ matched: false, reason: "Conditions did not match" }],
            completedAt: new Date(),
          })
          .where(eq(schema.automationRuns.id, run.id));
        continue;
      }

      const stepOutputs: Array<Record<string, unknown>> = [];
      let waiting = false;
      for (const action of automation.actions) {
        if (
          requiresApproval({
            actionType: action.type,
            autonomyLevel: automation.autonomyLevel,
            allowAutoExternal: automation.allowAutoExternal,
          })
        ) {
          const approvalId = crypto.randomUUID();
          await database.insert(schema.approvals).values({
            id: approvalId,
            userId: automation.userId,
            automationRunId: run.id,
            title: `${automation.name}: ${action.type.replaceAll("_", " ")}`,
            description: automation.description,
            actionType: action.type,
            payload: { action, context },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          });
          stepOutputs.push({ actionId: action.id, approvalId, status: "waiting_for_approval" });
          waiting = true;
          continue;
        }
        const output = await executeAutomationAction({
          action,
          automationRunId: run.id,
          context,
          userId: automation.userId,
        });
        stepOutputs.push({ actionId: action.id, status: "completed", output });
      }
      await database
        .update(schema.automationRuns)
        .set({
          status: waiting ? "waiting" : "completed",
          stepOutputs,
          completedAt: waiting ? null : new Date(),
        })
        .where(eq(schema.automationRuns.id, run.id));
      await database
        .update(schema.automations)
        .set({ lastRunAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(schema.automations.id, automation.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automation failed";
      await database
        .update(schema.automationRuns)
        .set({ status: "failed", error: message, completedAt: new Date() })
        .where(eq(schema.automationRuns.id, run.id));
      await database
        .update(schema.automations)
        .set({ lastError: message, updatedAt: new Date() })
        .where(eq(schema.automations.id, automation.id));
      throw error;
    }
  }
});

await boss.work<ExecuteApprovalJob>(JOBS.executeApproval, async (jobs) => {
  for (const job of jobs) {
    const [approval] = await database
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.id, job.data.approvalId),
          eq(schema.approvals.userId, job.data.userId),
          eq(schema.approvals.status, "approved"),
        ),
      )
      .limit(1);
    if (!approval) continue;
    const payload = approval.editedPayload ?? approval.payload;
    const action = payload.action as
      | { id: string; type: string; config: Record<string, unknown> }
      | undefined;
    const context = (payload.context as Record<string, unknown> | undefined) ?? {};
    if (!action) throw new Error("Approval payload has no action");
    const output = await executeAutomationAction({
      action,
      automationRunId: approval.automationRunId ?? approval.id,
      context,
      userId: approval.userId,
    });
    await database
      .update(schema.approvals)
      .set({ status: "executed", editedPayload: { ...payload, output }, decidedAt: new Date() })
      .where(eq(schema.approvals.id, approval.id));
    if (approval.automationRunId) {
      const remaining = await database
        .select({ id: schema.approvals.id })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.automationRunId, approval.automationRunId),
            eq(schema.approvals.status, "pending"),
          ),
        )
        .limit(1);
      if (!remaining.length) {
        await database
          .update(schema.automationRuns)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(schema.automationRuns.id, approval.automationRunId));
      }
    }
  }
});

await boss.work<EvaluateAutomationEventJob>(JOBS.evaluateAutomationEvent, async (jobs) => {
  for (const job of jobs) {
    const automations = await database
      .select()
      .from(schema.automations)
      .where(
        and(
          eq(schema.automations.userId, job.data.userId),
          eq(schema.automations.status, "active"),
          sql`${schema.automations.trigger}->>'type' = 'event'`,
          sql`${schema.automations.trigger}->>'event' = ${job.data.event}`,
        ),
      );
    for (const automation of automations) {
      const runId = crypto.randomUUID();
      const input = {
        event: job.data.event,
        ...(job.data.itemId ? { itemId: job.data.itemId } : {}),
      };
      await database.insert(schema.automationRuns).values({
        id: runId,
        userId: automation.userId,
        automationId: automation.id,
        triggerType: "event",
        input,
      });
      await boss.send(JOBS.runAutomation, {
        automationId: automation.id,
        runId,
        userId: automation.userId,
        input,
      });
    }
  }
});

function cronMatches(cron: string, date: Date, timeZone = "UTC") {
  const [minute, hour, day, month, weekday] = cron.trim().split(/\s+/);
  if (!minute || !hour || !day || !month || !weekday) return false;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      minute: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      day: "2-digit",
      month: "2-digit",
      weekday: "short",
      timeZone,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday ?? "",
  );
  const matches = (value: string, actual: number) => value === "*" || Number(value) === actual;
  return (
    matches(minute, Number(parts.minute)) &&
    matches(hour, Number(parts.hour)) &&
    matches(day, Number(parts.day)) &&
    matches(month, Number(parts.month)) &&
    matches(weekday, weekdayIndex)
  );
}

await boss.work(JOBS.runScheduledAutomations, async () => {
  const now = new Date();
  const automations = await database
    .select()
    .from(schema.automations)
    .where(
      and(
        eq(schema.automations.status, "active"),
        sql`${schema.automations.trigger}->>'type' = 'schedule'`,
      ),
    );
  for (const automation of automations) {
    if (automation.trigger.type !== "schedule") continue;
    if (!cronMatches(automation.trigger.cron, now, automation.trigger.timezone ?? "UTC")) continue;
    const minute = now.toISOString().slice(0, 16);
    const runId = crypto.randomUUID();
    await database.insert(schema.automationRuns).values({
      id: runId,
      userId: automation.userId,
      automationId: automation.id,
      triggerType: "schedule",
      input: { scheduledAt: now.toISOString() },
    });
    await boss.send(
      JOBS.runAutomation,
      { automationId: automation.id, runId, userId: automation.userId },
      { singletonKey: `${automation.id}:${minute}`, singletonSeconds: 60 },
    );
  }
});

await boss.work(JOBS.detectSuggestions, async () => {
  const patterns = await database
    .select({
      userId: schema.items.userId,
      provider: schema.items.provider,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.items)
    .where(eq(schema.items.status, "archived"))
    .groupBy(schema.items.userId, schema.items.provider)
    .having(sql`count(*) >= 10`);
  for (const pattern of patterns) {
    const name = `Auto-archive routine ${pattern.provider} items`;
    const [existing] = await database
      .select({ id: schema.automations.id })
      .from(schema.automations)
      .where(and(eq(schema.automations.userId, pattern.userId), eq(schema.automations.name, name)))
      .limit(1);
    if (existing) continue;
    await database.insert(schema.automations).values({
      id: crypto.randomUUID(),
      userId: pattern.userId,
      name,
      description: `Suggested after ${pattern.count} archived ${pattern.provider} items.`,
      status: "suggested",
      source: "pattern_detection",
      trigger: { type: "event", event: "item.created", provider: pattern.provider },
      conditions: [{ field: "provider", operator: "equals", value: pattern.provider }],
      actions: [
        {
          id: crypto.randomUUID(),
          type: "connector_action",
          config: { action: "archive" },
        },
      ],
      autonomyLevel: "approve",
    });
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
await boss.schedule(JOBS.syncFeeds, "*/15 * * * *");
await boss.schedule(JOBS.generateScheduledBriefings, "5 * * * *");
await boss.schedule(JOBS.runScheduledAutomations, "* * * * *");
await boss.schedule(JOBS.detectSuggestions, "30 3 * * *");
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
