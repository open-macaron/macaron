CREATE TABLE "config_snapshots" (
	"commit" text PRIMARY KEY,
	"files" jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "config_snapshots_applied_at" ON "config_snapshots" ("applied_at");