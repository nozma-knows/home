import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, users } from "./auth";

export type ConnectionProvider = "gmail" | "slack" | "linear";
export type ConnectionStatus = "active" | "needs_reattention" | "disconnected";
export type ItemStatus = "open" | "done" | "archived" | "snoozed";

export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").$type<ConnectionProvider>().notNull(),
    externalAccountId: text("external_account_id"),
    label: text("label").notNull(),
    status: text("status").$type<ConnectionStatus>().default("active").notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().default({}).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("connections_user_id_idx").on(table.userId),
    index("connections_organization_id_idx").on(table.organizationId),
    index("connections_provider_idx").on(table.provider),
    uniqueIndex("connections_external_account_unique").on(
      table.userId,
      table.provider,
      table.externalAccountId,
    ),
  ],
);

export const connectorOauthStates = pgTable(
  "connector_oauth_states",
  {
    state: text("state").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").$type<ConnectionProvider>().notNull(),
    codeVerifier: text("code_verifier"),
    returnTo: text("return_to").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("connector_oauth_states_user_id_idx").on(table.userId)],
);

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ConnectionProvider>().notNull(),
    externalId: text("external_id").notNull(),
    threadId: text("thread_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    preview: text("preview"),
    participants: jsonb("participants").$type<string[]>().default([]).notNull(),
    externalUrl: text("external_url"),
    status: text("status").$type<ItemStatus>().default("open").notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    isDirectMention: boolean("is_direct_mention").default(false).notNull(),
    isAssigned: boolean("is_assigned").default(false).notNull(),
    urgencyScore: doublePrecision("urgency_score").default(0).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("items_connection_external_unique").on(table.connectionId, table.externalId),
    index("items_user_status_occurred_idx").on(table.userId, table.status, table.occurredAt),
    index("items_organization_id_idx").on(table.organizationId),
    index("items_provider_idx").on(table.provider),
    index("items_snoozed_until_idx").on(table.snoozedUntil),
  ],
);

export const itemActionRequests = pgTable(
  "item_action_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().default({}).notNull(),
    status: text("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("item_action_requests_user_id_idx").on(table.userId),
    index("item_action_requests_status_idx").on(table.status),
  ],
);

export const connectionsRelations = relations(connections, ({ many, one }) => ({
  user: one(users, { fields: [connections.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [connections.organizationId],
    references: [organizations.id],
  }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ many, one }) => ({
  user: one(users, { fields: [items.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [items.organizationId],
    references: [organizations.id],
  }),
  connection: one(connections, {
    fields: [items.connectionId],
    references: [connections.id],
  }),
  actionRequests: many(itemActionRequests),
}));

export const itemActionRequestsRelations = relations(itemActionRequests, ({ one }) => ({
  user: one(users, { fields: [itemActionRequests.userId], references: [users.id] }),
  item: one(items, { fields: [itemActionRequests.itemId], references: [items.id] }),
}));
