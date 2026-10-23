ALTER TABLE "runs" ADD COLUMN "payer_id" text;--> statement-breakpoint
CREATE INDEX "runs_payer_created" ON "runs" ("payer_id","created_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_payer_id_users_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE SET NULL;