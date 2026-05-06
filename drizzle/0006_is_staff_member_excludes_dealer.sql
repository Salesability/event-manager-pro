-- Phase 1 follow-up to 0023-people-dealer-role: tighten `is_staff_member()`
-- so it returns false for users whose only `team_member_roles` rows are
-- `dealer`. Matches the app-layer filter in
-- src/lib/auth/load-team-membership.ts (`STAFF_APP_ROLES`) so RLS policies
-- and the `requireStaffAccess()` gate agree on what "staff" means.
--
-- Why: the previous helper (drizzle/0003_enable_rls.sql) was "any active
-- team_member_roles row → staff." Once 0023 introduces `dealer`, that would
-- have aliased dealer-side staff as us-side staff for the purposes of the
-- `<table>_staff_all` RLS policy. Closing the gap before any dealer row
-- exists (Phase 2 backfill is downstream of this migration).
--
-- `CREATE OR REPLACE` keeps the function idempotent. The whitelist
-- `('admin','staff','coach','viewer')` matches `STAFF_APP_ROLES`; new enum
-- values default to NOT-staff unless explicitly added here.

CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contacts c
    JOIN public.team_member_roles tmr ON tmr.contact_id = c.id
    WHERE c.user_id = (SELECT auth.uid())
      AND c.archived_at IS NULL
      AND tmr.archived_at IS NULL
      AND tmr.role IN ('admin', 'staff', 'coach', 'viewer')
  );
$$;
