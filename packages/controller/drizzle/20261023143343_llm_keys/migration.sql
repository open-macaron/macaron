CREATE TYPE "llm_key_event_kind" AS ENUM('created', 'replaced', 'deleted', 'used', 'rejected', 'unreachable');--> statement-breakpoint
CREATE TYPE "llm_key_status" AS ENUM('valid', 'rejected');--> statement-breakpoint
CREATE TABLE "llm_key_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"kind" "llm_key_event_kind" NOT NULL,
	"endpoint_id" uuid,
	"run_id" uuid,
	"last4" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_keys" (
	"user_id" text PRIMARY KEY,
	"endpoint_id" uuid NOT NULL,
	"kek_version" integer NOT NULL,
	"iv" bytea NOT NULL,
	"ciphertext" bytea NOT NULL,
	"tag" bytea NOT NULL,
	"last4" text NOT NULL,
	"status" "llm_key_status" DEFAULT 'valid'::"llm_key_status" NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_key_events_user_at" ON "llm_key_events" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "llm_key_events" ADD CONSTRAINT "llm_key_events_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "llm_key_events" ADD CONSTRAINT "llm_key_events_endpoint_id_llm_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "llm_endpoints"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "llm_key_events" ADD CONSTRAINT "llm_key_events_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "llm_keys" ADD CONSTRAINT "llm_keys_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "llm_keys" ADD CONSTRAINT "llm_keys_endpoint_id_llm_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "llm_endpoints"("id") ON DELETE RESTRICT;--> statement-breakpoint
-- The key history is append-only: no update, no delete, no truncate. Rows go only with their user
-- (ON DELETE CASCADE runs from the users table's foreign-key trigger, one trigger level deeper).
CREATE FUNCTION "llm_key_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'llm_key_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "llm_key_events_no_change" BEFORE UPDATE OR DELETE ON "llm_key_events" FOR EACH ROW EXECUTE FUNCTION "llm_key_events_append_only"();
--> statement-breakpoint
CREATE TRIGGER "llm_key_events_no_truncate" BEFORE TRUNCATE ON "llm_key_events" FOR EACH STATEMENT EXECUTE FUNCTION "llm_key_events_append_only"();
