CREATE TABLE "llm_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"base_url" text NOT NULL UNIQUE,
	"enabled" boolean DEFAULT true NOT NULL,
	"pricing_note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_endpoints" ADD CONSTRAINT "llm_endpoints_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;