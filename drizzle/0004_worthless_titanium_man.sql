CREATE TYPE "public"."audit_action" AS ENUM('user.role_changed', 'user.deactivated', 'dealer.archived', 'campaign.cancelled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" "audit_action" NOT NULL,
	"target_table" text NOT NULL,
	"target_id" bigint,
	"payload" jsonb
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_occurred_at_idx" ON "audit_log" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_table","target_id");--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- RLS for audit_log (hand-appended after `pnpm db:generate`; Drizzle doesn't
-- model RLS — see docs/wiki/conventions.md). Drizzle's `postgres` connection
-- bypasses these via BYPASSRLS, so existing Server Actions writing audit rows
-- are unaffected. The point is the day a JWT-bearing query path exists:
--   - service_role → permit all (admin client + future audit UI loads)
--   - authenticated → SELECT only their own actions (forensics-self-serve)
--   - authenticated INSERT/UPDATE/DELETE → no policy → default-deny (the app
--     writes audit rows via Drizzle/postgres; no JWT-bound writer should mint
--     audit entries directly)
--   - anon → no policy → default-deny
-- See docs/chunks/0019-security-architecture/plan.md Phase 4.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.audit_log enable row level security;
--> statement-breakpoint
drop policy if exists "audit_log_service_role_all" on public.audit_log;
--> statement-breakpoint
create policy "audit_log_service_role_all"
  on public.audit_log for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "audit_log_authenticated_read_own" on public.audit_log;
--> statement-breakpoint
create policy "audit_log_authenticated_read_own"
  on public.audit_log for select to authenticated
  using (actor_user_id = (select auth.uid()));
