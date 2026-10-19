CREATE TYPE "llm_backend" AS ENUM('openrouter', 'bifrost');--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "key_backend" "llm_backend";--> statement-breakpoint
-- Every key minted before this column existed is an OpenRouter key.
UPDATE "runs" SET "key_backend" = 'openrouter' WHERE "key_hash" IS NOT NULL;
