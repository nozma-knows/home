import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

export type AiProvider = "openai" | "anthropic" | "google";
export type ModelPurpose =
  | "chat"
  | "briefing"
  | "distillation"
  | "urgency_scoring"
  | "classification"
  | "automation_default";
export type SessionKind = "chat" | "coding";
export type SessionBackend = "hosted" | "local";
export type SessionMode = "plan" | "ask" | "auto";
export type SessionStatus = "idle" | "queued" | "running" | "waiting" | "failed";
export type MemoryKind = "fact" | "preference" | "person" | "project";

export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<AiProvider>().notNull(),
    credentialType: text("credential_type").default("api_key").notNull(),
    label: text("label").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    status: text("status").default("active").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("provider_accounts_user_id_idx").on(table.userId),
    index("provider_accounts_provider_idx").on(table.provider),
  ],
);

export const modelPreferences = pgTable(
  "model_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<ModelPurpose>().notNull(),
    tier: text("tier").$type<"frontier" | "fast">(),
    providerAccountId: text("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("model_preferences_user_purpose_unique").on(table.userId, table.purpose),
    index("model_preferences_account_idx").on(table.providerAccountId),
  ],
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").default("New session").notNull(),
    kind: text("kind").$type<SessionKind>().default("chat").notNull(),
    backend: text("backend").$type<SessionBackend>().default("hosted").notNull(),
    status: text("status").$type<SessionStatus>().default("idle").notNull(),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id, {
      onDelete: "set null",
    }),
    modelOverride: text("model_override"),
    effort: text("effort").default("medium").notNull(),
    mode: text("mode").$type<SessionMode>().default("ask").notNull(),
    enabledToolsets: jsonb("enabled_toolsets").$type<string[]>().default([]).notNull(),
    parentSessionId: text("parent_session_id"),
    sourcePlanId: text("source_plan_id"),
    repositoryPath: text("repository_path"),
    workingDirectory: text("working_directory"),
    lastError: text("last_error"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("agent_sessions_user_activity_idx").on(table.userId, table.lastActivityAt),
    index("agent_sessions_parent_idx").on(table.parentSessionId),
  ],
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    role: text("role"),
    content: text("content"),
    model: text("model"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("session_events_sequence_unique").on(table.sessionId, table.sequence),
    index("session_events_user_session_idx").on(table.userId, table.sessionId),
  ],
);

export const sessionRuns = pgTable(
  "session_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    status: text("status").default("queued").notNull(),
    inputEventId: text("input_event_id").references(() => sessionEvents.id, {
      onDelete: "set null",
    }),
    outputEventId: text("output_event_id").references(() => sessionEvents.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("session_runs_user_session_idx").on(table.userId, table.sessionId),
    index("session_runs_status_idx").on(table.status),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MemoryKind>().notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    source: text("source").notNull(),
    sourceId: text("source_id"),
    confidence: doublePrecision("confidence").default(0.7).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("memories_user_kind_idx").on(table.userId, table.kind),
    index("memories_source_idx").on(table.source, table.sourceId),
  ],
);

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    provider: text("provider").$type<AiProvider>().notNull(),
    model: text("model").notNull(),
    purpose: text("purpose").$type<ModelPurpose>().notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    totalTokens: integer("total_tokens").default(0).notNull(),
    estimatedCostUsd: doublePrecision("estimated_cost_usd"),
    substitutionReason: text("substitution_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("usage_logs_user_created_idx").on(table.userId, table.createdAt),
    index("usage_logs_purpose_idx").on(table.purpose),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => agentSessions.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("attachments_object_key_unique").on(table.objectKey),
    index("attachments_user_session_idx").on(table.userId, table.sessionId),
  ],
);

export const providerAccountsRelations = relations(providerAccounts, ({ many, one }) => ({
  user: one(users, { fields: [providerAccounts.userId], references: [users.id] }),
  preferences: many(modelPreferences),
  sessions: many(agentSessions),
}));

export const agentSessionsRelations = relations(agentSessions, ({ many, one }) => ({
  user: one(users, { fields: [agentSessions.userId], references: [users.id] }),
  providerAccount: one(providerAccounts, {
    fields: [agentSessions.providerAccountId],
    references: [providerAccounts.id],
  }),
  events: many(sessionEvents),
  runs: many(sessionRuns),
  attachments: many(attachments),
}));
