import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { agentSessions } from "./ai";
import { users } from "./auth";

export const sidecarTokens = pgTable(
  "sidecar_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    deviceName: text("device_name").notNull(),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sidecar_tokens_hash_unique").on(table.tokenHash),
    index("sidecar_tokens_user_idx").on(table.userId),
  ],
);

export const sessionPermissions = pgTable(
  "session_permissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    command: text("command").notNull(),
    workingDirectory: text("working_directory").notNull(),
    status: text("status").default("pending").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("session_permissions_user_status_idx").on(table.userId, table.status),
    index("session_permissions_session_idx").on(table.sessionId),
  ],
);
