-- chunk 0063: stub the Supabase-managed `auth.users` table.
--
-- The Drizzle migrations FK-reference `auth.users` (created_by_id /
-- updated_by_id / contacts.user_id) but never create it — see the header of
-- drizzle/0000_cute_ser_duncan.sql ("auth.users is managed by Supabase; not
-- created here"). Against a vanilla Postgres container those FK constraints
-- would fail, so we create a minimal stub carrying just the `id` PK the FKs
-- point at. Production uses the real Supabase-managed table; this exists only
-- so the migration chain replays cleanly from zero in the test container.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- `auth.uid()` is provided by Supabase (reads the request's JWT `sub` claim).
-- RLS policies in 0003_enable_rls.sql reference it. In the test container there
-- is no JWT context, so the stub returns NULL — policies still create fine, and
-- the superuser connection used by the harness bypasses RLS regardless.
CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$ SELECT NULL::uuid $$;

-- Supabase predefined roles that the RLS migrations GRANT to / reference
-- (0003_enable_rls.sql onward use `authenticated` + `service_role`; `anon` is
-- included for completeness). NOLOGIN stubs — the harness connects as the
-- superuser, so these only need to exist for the GRANT/policy statements.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
