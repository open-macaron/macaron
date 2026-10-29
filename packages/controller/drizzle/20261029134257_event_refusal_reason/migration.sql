ALTER TABLE "events" ADD COLUMN "refusal" text;--> statement-breakpoint
CREATE INDEX "events_created" ON "events" ("created_at");