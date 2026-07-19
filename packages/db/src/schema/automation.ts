import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { agentSessions, providerAccounts } from "./ai";
import { organizations, users } from "./auth";

export type AutonomyLevel = "suggest" | "approve" | "auto";
export type AutomationStatus = "draft" | "suggested" | "active" | "paused";
export type AutomationTrigger =
  | { type: "manual" }
  | { type: "schedule"; cron: string; timezone?: string }
  | { type: "event"; event: string; provider?: string };
export type AutomationCondition = {
  field: "provider" | "sender" | "title" | "body" | "isAssigned" | "isDirectMention";
  operator: "equals" | "contains" | "is";
  value: string | boolean;
};
export type AutomationAction = {
  id: string;
  type: "connector_action" | "create_memory" | "notify" | "llm";
  config: Record<string, unknown>;
  modelOverride?: string;
};

export const automations = pgTable(
  "automations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").$type<AutomationStatus>().default("draft").notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    conditions: jsonb("conditions").$type<AutomationCondition[]>().default([]).notNull(),
    actions: jsonb("actions").$type<AutomationAction[]>().default([]).notNull(),
    autonomyLevel: text("autonomy_level").$type<AutonomyLevel>().default("approve").notNull(),
    allowAutoExternal: boolean("allow_auto_external").default(false).notNull(),
    providerAccountId: text("provider_account_id").references(() => providerAccounts.id, {
      onDelete: "set null",
    }),
    modelOverride: text("model_override"),
    source: text("source").default("manual").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("automations_user_status_idx").on(table.userId, table.status),
    index("automations_organization_idx").on(table.organizationId),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    status: text("status").default("queued").notNull(),
    triggerType: text("trigger_type").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().default({}).notNull(),
    stepOutputs: jsonb("step_outputs")
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("automation_runs_user_created_idx").on(table.userId, table.createdAt),
    index("automation_runs_automation_idx").on(table.automationId),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    automationRunId: text("automation_run_id").references(() => automationRuns.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    actionType: text("action_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    editedPayload: jsonb("edited_payload").$type<Record<string, unknown>>(),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("approvals_user_status_idx").on(table.userId, table.status),
    index("approvals_expires_idx").on(table.expiresAt),
  ],
);

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    transport: text("transport").notNull(),
    url: text("url"),
    command: text("command"),
    encryptedConfig: text("encrypted_config"),
    enabled: boolean("enabled").default(true).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("mcp_servers_user_idx").on(table.userId),
    index("mcp_servers_organization_idx").on(table.organizationId),
  ],
);

export const plugins = pgTable(
  "plugins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    slashCommand: text("slash_command").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("plugins_user_command_unique").on(table.userId, table.slashCommand),
    index("plugins_organization_idx").on(table.organizationId),
  ],
);

export const planArtifacts = pgTable(
  "plan_artifacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("plan_artifacts_user_session_idx").on(table.userId, table.sessionId)],
);

export const automationsRelations = relations(automations, ({ many, one }) => ({
  user: one(users, { fields: [automations.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [automations.organizationId],
    references: [organizations.id],
  }),
  runs: many(automationRuns),
}));

export const automationRunsRelations = relations(automationRuns, ({ many, one }) => ({
  automation: one(automations, {
    fields: [automationRuns.automationId],
    references: [automations.id],
  }),
  approvals: many(approvals),
}));
