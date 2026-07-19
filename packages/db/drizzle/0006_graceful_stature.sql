CREATE TABLE "session_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text NOT NULL,
	"command" text NOT NULL,
	"working_directory" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sidecar_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"device_name" text NOT NULL,
	"last_connected_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_permissions" ADD CONSTRAINT "session_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_permissions" ADD CONSTRAINT "session_permissions_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidecar_tokens" ADD CONSTRAINT "sidecar_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_permissions_user_status_idx" ON "session_permissions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "session_permissions_session_idx" ON "session_permissions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sidecar_tokens_hash_unique" ON "sidecar_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sidecar_tokens_user_idx" ON "sidecar_tokens" USING btree ("user_id");