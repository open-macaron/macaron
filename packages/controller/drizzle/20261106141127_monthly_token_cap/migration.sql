ALTER TABLE "runs" ADD COLUMN "token_limit" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_token_cap" bigint DEFAULT 500000000;