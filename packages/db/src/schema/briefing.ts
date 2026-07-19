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

import { organizations, users } from "./auth";

export type BriefingSections = {
  priorities: Array<{ id: string; title: string; provider: string; reason: string; url?: string }>;
  waiting: Array<{ id: string; title: string; provider: string; url?: string }>;
  blocking: Array<{ id: string; title: string; provider: string; url?: string }>;
  approvals: Array<{ id: string; title: string; type: string }>;
  news: Array<{ id: string; title: string; source: string; why: string; url?: string }>;
};

export const briefingPreferences = pgTable(
  "briefing_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    timezone: text("timezone").default("America/New_York").notNull(),
    deliveryHour: integer("delivery_hour").default(7).notNull(),
    newsLimit: integer("news_limit").default(8).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastGeneratedDate: text("last_generated_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("briefing_preferences_user_unique").on(table.userId)],
);

export const briefings = pgTable(
  "briefings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    status: text("status").default("ready").notNull(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull(),
    sections: jsonb("sections").$type<BriefingSections>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("briefings_user_date_unique").on(table.userId, table.localDate),
    index("briefings_user_generated_idx").on(table.userId, table.generatedAt),
  ],
);

export const rssFeeds = pgTable(
  "rss_feeds",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    active: boolean("active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("rss_feeds_user_url_unique").on(table.userId, table.url),
    index("rss_feeds_organization_idx").on(table.organizationId),
  ],
);

export const newsTopics = pgTable(
  "news_topics",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    topic: text("topic").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("news_topics_user_topic_unique").on(table.userId, table.topic),
    index("news_topics_organization_idx").on(table.organizationId),
  ],
);

export const briefingsRelations = relations(briefings, ({ one }) => ({
  user: one(users, { fields: [briefings.userId], references: [users.id] }),
}));

export const rssFeedsRelations = relations(rssFeeds, ({ one }) => ({
  user: one(users, { fields: [rssFeeds.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [rssFeeds.organizationId],
    references: [organizations.id],
  }),
}));
