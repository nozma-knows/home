CREATE TABLE "briefing_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"delivery_hour" integer DEFAULT 7 NOT NULL,
	"news_limit" integer DEFAULT 8 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_generated_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"sections" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"topic" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rss_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "briefing_preferences" ADD CONSTRAINT "briefing_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_topics" ADD CONSTRAINT "news_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_topics" ADD CONSTRAINT "news_topics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rss_feeds" ADD CONSTRAINT "rss_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rss_feeds" ADD CONSTRAINT "rss_feeds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "briefing_preferences_user_unique" ON "briefing_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "briefings_user_date_unique" ON "briefings" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "briefings_user_generated_idx" ON "briefings" USING btree ("user_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_topics_user_topic_unique" ON "news_topics" USING btree ("user_id","topic");--> statement-breakpoint
CREATE INDEX "news_topics_organization_idx" ON "news_topics" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rss_feeds_user_url_unique" ON "rss_feeds" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "rss_feeds_organization_idx" ON "rss_feeds" USING btree ("organization_id");