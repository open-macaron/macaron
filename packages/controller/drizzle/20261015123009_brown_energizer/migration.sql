CREATE TYPE "event_status" AS ENUM('pending', 'claimed', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "ledger_kind" AS ENUM('run', 'router');--> statement-breakpoint
CREATE TYPE "run_mode" AS ENUM('triage', 'plan', 'implement', 'address_review', 'reproduce', 'verify', 'retro');--> statement-breakpoint
CREATE TYPE "run_status" AS ENUM('pending', 'dispatched', 'running', 'completed', 'failed', 'aborted');--> statement-breakpoint
CREATE TYPE "thread_kind" AS ENUM('issue', 'pull');--> statement-breakpoint
CREATE TABLE "effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"thread_id" uuid NOT NULL,
	"loop" integer NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"thread_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"author" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"body" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "event_status" DEFAULT 'pending'::"event_status" NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" "ledger_kind" NOT NULL,
	"run_id" uuid,
	"repo" text NOT NULL,
	"project" text NOT NULL,
	"usd_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_state" (
	"id" integer PRIMARY KEY,
	"last_modified" text,
	"interval_sec" integer NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "poll_state_singleton" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"ticket" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"loop" integer NOT NULL,
	"mode" "run_mode" NOT NULL,
	"status" "run_status" DEFAULT 'pending'::"run_status" NOT NULL,
	"harness" text NOT NULL,
	"model" text NOT NULL,
	"context" jsonb NOT NULL,
	"key_hash" text,
	"key_secret" text,
	"limit_micros" bigint NOT NULL,
	"cost_micros" bigint,
	"gh_run_id" bigint,
	"redeemed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"kind" "thread_kind" NOT NULL,
	"branch" text,
	"pr_number" integer,
	"loops" integer DEFAULT 0 NOT NULL,
	"status_comment_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "effects_thread_loop_kind" ON "effects" ("thread_id","loop","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "events_thread_external" ON "events" ("thread_id","external_id");--> statement-breakpoint
CREATE INDEX "events_due" ON "events" ("status","due_at");--> statement-breakpoint
CREATE INDEX "ledger_repo_at" ON "ledger" ("repo","created_at");--> statement-breakpoint
CREATE INDEX "ledger_project_at" ON "ledger" ("project","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_ticket" ON "runs" ("ticket");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_gh_run" ON "runs" ("gh_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_thread_loop" ON "runs" ("thread_id","loop");--> statement-breakpoint
CREATE INDEX "runs_status" ON "runs" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_repo_number" ON "threads" ("repo","number");--> statement-breakpoint
CREATE INDEX "threads_repo_pr" ON "threads" ("repo","pr_number");--> statement-breakpoint
ALTER TABLE "effects" ADD CONSTRAINT "effects_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_thread_id_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE RESTRICT;