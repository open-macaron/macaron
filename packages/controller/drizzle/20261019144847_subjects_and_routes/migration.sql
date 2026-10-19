ALTER TABLE "events" ADD COLUMN "subject_kind" "thread_kind";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "subject_number" integer;--> statement-breakpoint
-- Existing events: the subject is in their URL (…/pull/N or …/issues/N), else the thread's own number.
UPDATE "events" AS e SET
  "subject_kind" = CASE WHEN e."url" ~ '/pull/[0-9]+' THEN 'pull'::"thread_kind" ELSE 'issue'::"thread_kind" END,
  "subject_number" = COALESCE(substring(e."url" from '/pull/([0-9]+)')::integer, substring(e."url" from '/issues/([0-9]+)')::integer, t."number")
FROM "threads" AS t WHERE t."id" = e."thread_id";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "subject_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "subject_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "route" jsonb;
