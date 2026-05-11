-- Phase 2 follow-up for 0037-commercial-spine-msa: enable Row Level Security
-- on `master_service_agreements`, mirroring the baseline established in
-- drizzle/0003_enable_rls.sql so every public domain table is uniformly
-- gated (`service_role` permit-all + `authenticated` staff-only via
-- `public.is_staff_member()`).
--
-- Drizzle continues to bypass RLS via the `postgres` connection role's
-- BYPASSRLS attribute; existing/future Server Actions are unaffected. The
-- policies kick in the day a JWT-bearing query path reads or writes MSA rows
-- (notably 7.2's dealer-portal sign flow and any future audit UI).
--
-- Idempotent: ALTER TABLE … ENABLE ROW LEVEL SECURITY is safe to re-run; each
-- CREATE POLICY is preceded by DROP POLICY IF EXISTS.

alter table public.master_service_agreements enable row level security;
--> statement-breakpoint
drop policy if exists "master_service_agreements_service_role_all" on public.master_service_agreements;
--> statement-breakpoint
create policy "master_service_agreements_service_role_all"
  on public.master_service_agreements for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "master_service_agreements_staff_all" on public.master_service_agreements;
--> statement-breakpoint
create policy "master_service_agreements_staff_all"
  on public.master_service_agreements for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
