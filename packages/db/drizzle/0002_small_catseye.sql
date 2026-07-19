CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New session' NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"backend" text DEFAULT 'hosted' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"provider_account_id" text,
	"model_override" text,
	"effort" text DEFAULT 'medium' NOT NULL,
	"mode" text DEFAULT 'ask' NOT NULL,
	"enabled_toolsets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_session_id" text,
	"source_plan_id" text,
	"repository_path" text,
	"working_directory" text,
	"last_error" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"source" text NOT NULL,
	"source_id" text,
	"confidence" double precision DEFAULT 0.7 NOT NULL,
	"last_used_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"tier" text,
	"provider_account_id" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"credential_type" text DEFAULT 'api_key' NOT NULL,
	"label" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"role" text,
	"content" text,
	"model" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input_event_id" text,
	"output_event_id" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_account_id" text,
	"session_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision,
	"substitution_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_preferences" ADD CONSTRAINT "model_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_preferences" ADD CONSTRAINT "model_preferences_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_runs" ADD CONSTRAINT "session_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_runs" ADD CONSTRAINT "session_runs_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_runs" ADD CONSTRAINT "session_runs_input_event_id_session_events_id_fk" FOREIGN KEY ("input_event_id") REFERENCES "public"."session_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_runs" ADD CONSTRAINT "session_runs_output_event_id_session_events_id_fk" FOREIGN KEY ("output_event_id") REFERENCES "public"."session_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_user_activity_idx" ON "agent_sessions" USING btree ("user_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "agent_sessions_parent_idx" ON "agent_sessions" USING btree ("parent_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_object_key_unique" ON "attachments" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "attachments_user_session_idx" ON "attachments" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "memories_user_kind_idx" ON "memories" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "memories_source_idx" ON "memories" USING btree ("source","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_preferences_user_purpose_unique" ON "model_preferences" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "model_preferences_account_idx" ON "model_preferences" USING btree ("provider_account_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_user_id_idx" ON "provider_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_provider_idx" ON "provider_accounts" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_sequence_unique" ON "session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "session_events_user_session_idx" ON "session_events" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "session_runs_user_session_idx" ON "session_runs" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "session_runs_status_idx" ON "session_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_logs_user_created_idx" ON "usage_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_purpose_idx" ON "usage_logs" USING btree ("purpose");
