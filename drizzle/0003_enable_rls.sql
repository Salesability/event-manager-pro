-- Phase 1 of 0019-security-architecture: enable Row Level Security on every
-- public domain table, with policies that mirror the staff app's existing
-- authz (any user with an active team_member_roles row is staff; staff sees
-- and mutates everything). Drizzle continues to bypass RLS via the `postgres`
-- connection role's BYPASSRLS attribute (verified 2026-05-06: rolbypassrls=t),
-- so existing Server Actions are unchanged. The `service_role` used by
-- supabase-js admin clients also bypasses; explicit "permit all" policies are
-- written anyway so the intent is readable in the SQL.
--
-- The point of these policies is **defence in depth for the day a JWT-bearing
-- query path exists** (the dealer portal). Today the staff app reaches the DB
-- only as `postgres` (via Drizzle), so RLS is invisible to it. The day a
-- portal route handler queries via supabase-js with a user JWT, PostgREST sets
-- the role to `authenticated` and these policies kick in.
--
-- anon falls through to default-deny (no policy → no rows visible). The
-- /share/coach/[id] public page does NOT hit the DB as anon — it queries via
-- Drizzle on the server, which bypasses RLS. So no anon read policies are
-- needed today.
--
-- Idempotent: ALTER TABLE … ENABLE ROW LEVEL SECURITY is safe to re-run; every
-- CREATE POLICY is preceded by DROP POLICY IF EXISTS; the helper function
-- uses CREATE OR REPLACE.
--
-- See docs/chunks/0019-security-architecture/plan.md Phase 1.

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: is the current authenticated user an active staff member?
-- SECURITY DEFINER lets the function read contacts + team_member_roles even
-- when RLS would otherwise hide them from the calling role. The function
-- exposes only a boolean, so it cannot be used to exfiltrate data.
-- Returns false for anon (auth.uid() is NULL).
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.is_staff_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contacts c
    join public.team_member_roles tmr on tmr.contact_id = c.id
    where c.user_id = (select auth.uid())
      and c.archived_at is null
      and tmr.archived_at is null
  );
$$;
--> statement-breakpoint
revoke execute on function public.is_staff_member() from public;
--> statement-breakpoint
grant execute on function public.is_staff_member() to authenticated, service_role;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- availability_blocks
-- ────────────────────────────────────────────────────────────────────────────
alter table public.availability_blocks enable row level security;
--> statement-breakpoint
drop policy if exists "availability_blocks_service_role_all" on public.availability_blocks;
--> statement-breakpoint
create policy "availability_blocks_service_role_all"
  on public.availability_blocks for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "availability_blocks_staff_all" on public.availability_blocks;
--> statement-breakpoint
create policy "availability_blocks_staff_all"
  on public.availability_blocks for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- campaign_styles (lookup)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.campaign_styles enable row level security;
--> statement-breakpoint
drop policy if exists "campaign_styles_service_role_all" on public.campaign_styles;
--> statement-breakpoint
create policy "campaign_styles_service_role_all"
  on public.campaign_styles for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "campaign_styles_staff_all" on public.campaign_styles;
--> statement-breakpoint
create policy "campaign_styles_staff_all"
  on public.campaign_styles for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- campaigns
-- ────────────────────────────────────────────────────────────────────────────
alter table public.campaigns enable row level security;
--> statement-breakpoint
drop policy if exists "campaigns_service_role_all" on public.campaigns;
--> statement-breakpoint
create policy "campaigns_service_role_all"
  on public.campaigns for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "campaigns_staff_all" on public.campaigns;
--> statement-breakpoint
create policy "campaigns_staff_all"
  on public.campaigns for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- contact_identifiers
-- ────────────────────────────────────────────────────────────────────────────
alter table public.contact_identifiers enable row level security;
--> statement-breakpoint
drop policy if exists "contact_identifiers_service_role_all" on public.contact_identifiers;
--> statement-breakpoint
create policy "contact_identifiers_service_role_all"
  on public.contact_identifiers for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "contact_identifiers_staff_all" on public.contact_identifiers;
--> statement-breakpoint
create policy "contact_identifiers_staff_all"
  on public.contact_identifiers for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- contacts
-- ────────────────────────────────────────────────────────────────────────────
alter table public.contacts enable row level security;
--> statement-breakpoint
drop policy if exists "contacts_service_role_all" on public.contacts;
--> statement-breakpoint
create policy "contacts_service_role_all"
  on public.contacts for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "contacts_staff_all" on public.contacts;
--> statement-breakpoint
create policy "contacts_staff_all"
  on public.contacts for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- dealer_contacts
-- ────────────────────────────────────────────────────────────────────────────
alter table public.dealer_contacts enable row level security;
--> statement-breakpoint
drop policy if exists "dealer_contacts_service_role_all" on public.dealer_contacts;
--> statement-breakpoint
create policy "dealer_contacts_service_role_all"
  on public.dealer_contacts for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "dealer_contacts_staff_all" on public.dealer_contacts;
--> statement-breakpoint
create policy "dealer_contacts_staff_all"
  on public.dealer_contacts for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- dealers
-- ────────────────────────────────────────────────────────────────────────────
alter table public.dealers enable row level security;
--> statement-breakpoint
drop policy if exists "dealers_service_role_all" on public.dealers;
--> statement-breakpoint
create policy "dealers_service_role_all"
  on public.dealers for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "dealers_staff_all" on public.dealers;
--> statement-breakpoint
create policy "dealers_staff_all"
  on public.dealers for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- sales_lead_sources (lookup)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.sales_lead_sources enable row level security;
--> statement-breakpoint
drop policy if exists "sales_lead_sources_service_role_all" on public.sales_lead_sources;
--> statement-breakpoint
create policy "sales_lead_sources_service_role_all"
  on public.sales_lead_sources for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "sales_lead_sources_staff_all" on public.sales_lead_sources;
--> statement-breakpoint
create policy "sales_lead_sources_staff_all"
  on public.sales_lead_sources for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- team_member_roles
-- ────────────────────────────────────────────────────────────────────────────
alter table public.team_member_roles enable row level security;
--> statement-breakpoint
drop policy if exists "team_member_roles_service_role_all" on public.team_member_roles;
--> statement-breakpoint
create policy "team_member_roles_service_role_all"
  on public.team_member_roles for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "team_member_roles_staff_all" on public.team_member_roles;
--> statement-breakpoint
create policy "team_member_roles_staff_all"
  on public.team_member_roles for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- vehicle_ownerships
-- ────────────────────────────────────────────────────────────────────────────
alter table public.vehicle_ownerships enable row level security;
--> statement-breakpoint
drop policy if exists "vehicle_ownerships_service_role_all" on public.vehicle_ownerships;
--> statement-breakpoint
create policy "vehicle_ownerships_service_role_all"
  on public.vehicle_ownerships for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "vehicle_ownerships_staff_all" on public.vehicle_ownerships;
--> statement-breakpoint
create policy "vehicle_ownerships_staff_all"
  on public.vehicle_ownerships for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- vehicles
-- ────────────────────────────────────────────────────────────────────────────
alter table public.vehicles enable row level security;
--> statement-breakpoint
drop policy if exists "vehicles_service_role_all" on public.vehicles;
--> statement-breakpoint
create policy "vehicles_service_role_all"
  on public.vehicles for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "vehicles_staff_all" on public.vehicles;
--> statement-breakpoint
create policy "vehicles_staff_all"
  on public.vehicles for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());
