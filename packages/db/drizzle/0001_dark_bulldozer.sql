CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"provider" text NOT NULL,
	"external_account_id" text,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"provider" text NOT NULL,
	"code_verifier" text,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_action_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"action" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"thread_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"preview" text,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_url" text,
	"status" text DEFAULT 'open' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_direct_mention" boolean DEFAULT false NOT NULL,
	"is_assigned" boolean DEFAULT false NOT NULL,
	"urgency_score" double precision DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"snoozed_until" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_oauth_states" ADD CONSTRAINT "connector_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_oauth_states" ADD CONSTRAINT "connector_oauth_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_action_requests" ADD CONSTRAINT "item_action_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_action_requests" ADD CONSTRAINT "item_action_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_user_id_idx" ON "connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "connections_organization_id_idx" ON "connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "connections_provider_idx" ON "connections" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_external_account_unique" ON "connections" USING btree ("user_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "connector_oauth_states_user_id_idx" ON "connector_oauth_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "item_action_requests_user_id_idx" ON "item_action_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "item_action_requests_status_idx" ON "item_action_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "items_connection_external_unique" ON "items" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "items_user_status_occurred_idx" ON "items" USING btree ("user_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "items_organization_id_idx" ON "items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "items_provider_idx" ON "items" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "items_snoozed_until_idx" ON "items" USING btree ("snoozed_until");