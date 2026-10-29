CREATE TABLE "forks" (
	"upstream_id" bigint PRIMARY KEY,
	"upstream_key" text NOT NULL,
	"fork_id" bigint NOT NULL,
	"fork_name" text NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "forks_upstream_key" ON "forks" ("upstream_key");