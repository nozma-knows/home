ALTER TABLE "items" ADD COLUMN "rss_feed_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_rss_feed_id_rss_feeds_id_fk" FOREIGN KEY ("rss_feed_id") REFERENCES "public"."rss_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_feed_external_unique" ON "items" USING btree ("rss_feed_id","external_id");