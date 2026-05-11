-- Phase 1 follow-up for 0035-quote-composer: enable Row Level Security on
-- `service_items`, mirroring the baseline established in
-- drizzle/0003_enable_rls.sql so every public domain + lookup table is
-- uniformly gated (`service_role` permit-all + `authenticated` staff-only via
-- `public.is_staff_member()`).
--
-- Drizzle continues to bypass RLS via the `postgres` connection role's
-- BYPASSRLS attribute; existing/future Server Actions are unaffected. The
-- policies kick in the day a JWT-bearing query path reads service-item rows
-- (none today — the catalog is admin-only via Drizzle).
--
-- Idempotent: ALTER TABLE … ENABLE ROW LEVEL SECURITY is safe to re-run; each
-- CREATE POLICY is preceded by DROP POLICY IF EXISTS.

alter table public.service_items enable row level security;
--> statement-breakpoint
drop policy if exists "service_items_service_role_all" on public.service_items;
--> statement-breakpoint
create policy "service_items_service_role_all"
  on public.service_items for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "service_items_staff_all" on public.service_items;
--> statement-breakpoint
create policy "service_items_staff_all"
  on public.service_items for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
