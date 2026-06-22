CREATE TYPE "public"."dealer_activity_kind" AS ENUM('call', 'email', 'meeting', 'note', 'other');--> statement-breakpoint
CREATE TYPE "public"."dealer_pipeline_stage" AS ENUM('new', 'researching', 'contacted', 'follow_up', 'meeting_booked', 'proposal_sent', 'negotiation', 'on_hold', 'lost');--> statement-breakpoint
CREATE TYPE "public"."dealer_priority" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "dealer_activities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dealer_activities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dealer_id" bigint NOT NULL,
	"kind" "dealer_activity_kind" NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "pipeline_stage" "dealer_pipeline_stage";--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "priority" "dealer_priority";--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "next_action" text;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "next_action_at" date;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "last_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "stage_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dealer_activities" ADD CONSTRAINT "dealer_activities_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_activities" ADD CONSTRAINT "dealer_activities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_activities" ADD CONSTRAINT "dealer_activities_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealer_activities_dealer_id_idx" ON "dealer_activities" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX "dealer_activities_created_by_id_occurred_at_idx" ON "dealer_activities" USING btree ("created_by_id","occurred_at");--> statement-breakpoint
CREATE INDEX "dealer_activities_updated_by_id_idx" ON "dealer_activities" USING btree ("updated_by_id");--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealers_pipeline_stage_idx" ON "dealers" USING btree ("pipeline_stage");--> statement-breakpoint
CREATE INDEX "dealers_owner_id_idx" ON "dealers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "dealers_next_action_at_idx" ON "dealers" USING btree ("next_action_at");--> statement-breakpoint
-- RLS (0087): dealer_activities is a child-of-dealers domain table, so it gets the
-- standard two policies matching dealer_contacts (service_role permit-all +
-- authenticated staff-only via public.is_staff_member()). New public tables ship
-- RLS-on or Supabase's advisor flags them `rls_disabled_in_public`. Drizzle
-- bypasses RLS via the postgres role's BYPASSRLS, so the admin-only Server Action
-- data path is unaffected; the policies gate any future JWT-bearing query path.
-- Idempotent: ENABLE is re-run-safe; each CREATE POLICY is preceded by DROP IF EXISTS.
ALTER TABLE "public"."dealer_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "dealer_activities_service_role_all" ON "public"."dealer_activities";--> statement-breakpoint
CREATE POLICY "dealer_activities_service_role_all"
  ON "public"."dealer_activities" FOR ALL TO service_role
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "dealer_activities_staff_all" ON "public"."dealer_activities";--> statement-breakpoint
CREATE POLICY "dealer_activities_staff_all"
  ON "public"."dealer_activities" FOR ALL TO authenticated
  USING (public.is_staff_member()) WITH CHECK (public.is_staff_member());--> statement-breakpoint
-- 0086 backfill (decision.md D5): the imported cold prospects start their funnel
-- at `new`. Scope to status='prospect' (won/active dealers have no stage — NULL
-- is correct); idempotent via `pipeline_stage IS NULL`. dealers is small (~333
-- prod rows), so a constant UPDATE in-migration is safe (db-conventions).
UPDATE "dealers" SET "pipeline_stage" = 'new' WHERE "status" = 'prospect' AND "pipeline_stage" IS NULL;