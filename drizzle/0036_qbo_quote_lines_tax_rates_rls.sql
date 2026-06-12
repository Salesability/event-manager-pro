-- Close the RLS gap on the three public tables created AFTER the last RLS
-- migration (0023): quote_line_items (0024), tax_rates, and quickbooks_connection.
-- Supabase's advisor flagged these as `rls_disabled_in_public` (Critical) on the
-- prod project — with RLS off, the `anon`/`authenticated` roles' default GRANTs
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE) are the only gate, so anyone with the
-- public anon key could read or mutate every row through PostgREST.
--
-- Mirrors the baseline in drizzle/0003_enable_rls.sql + 0014_service_items_rls.sql
-- + 0023_volatile_killer_shrike.sql. Drizzle bypasses RLS via the postgres role's
-- BYPASSRLS attribute, so the admin-only Server Action data path is unaffected;
-- the policies gate any future JWT-bearing query path.
--
-- quote_line_items + tax_rates get the standard two policies (service_role
-- permit-all + authenticated staff-only via public.is_staff_member()), matching
-- every other domain/lookup table. quickbooks_connection is a SECRETS table
-- (encrypted OAuth tokens) that no JWT-bearing path should ever read, so it gets
-- the service_role policy ONLY — RLS-on with no authenticated policy is
-- default-deny for both anon and authenticated.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is re-run-safe; each CREATE POLICY is
-- preceded by DROP POLICY IF EXISTS.

-- quote_line_items --------------------------------------------------------------
alter table public.quote_line_items enable row level security;--> statement-breakpoint
drop policy if exists "quote_line_items_service_role_all" on public.quote_line_items;--> statement-breakpoint
create policy "quote_line_items_service_role_all"
  on public.quote_line_items for all to service_role
  using (true) with check (true);--> statement-breakpoint
drop policy if exists "quote_line_items_staff_all" on public.quote_line_items;--> statement-breakpoint
create policy "quote_line_items_staff_all"
  on public.quote_line_items for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());--> statement-breakpoint

-- tax_rates ---------------------------------------------------------------------
alter table public.tax_rates enable row level security;--> statement-breakpoint
drop policy if exists "tax_rates_service_role_all" on public.tax_rates;--> statement-breakpoint
create policy "tax_rates_service_role_all"
  on public.tax_rates for all to service_role
  using (true) with check (true);--> statement-breakpoint
drop policy if exists "tax_rates_staff_all" on public.tax_rates;--> statement-breakpoint
create policy "tax_rates_staff_all"
  on public.tax_rates for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());--> statement-breakpoint

-- quickbooks_connection (secrets table — service_role only, no authenticated) ----
alter table public.quickbooks_connection enable row level security;--> statement-breakpoint
drop policy if exists "quickbooks_connection_service_role_all" on public.quickbooks_connection;--> statement-breakpoint
create policy "quickbooks_connection_service_role_all"
  on public.quickbooks_connection for all to service_role
  using (true) with check (true);
