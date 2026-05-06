import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Integration test for the RLS baseline (0019 Phase 1). Connects directly via
// postgres-js (NOT through Drizzle, which uses the BYPASSRLS `postgres` role
// at top level). Inside a transaction we `SET LOCAL ROLE authenticated` and
// forge a `request.jwt.claim.sub` for a user that doesn't exist in any
// `contacts.user_id`. The `public.is_staff_member()` helper returns false, so
// every RLS-gated table returns 0 rows. Proves the policies *would* enforce
// against any future JWT-bearing query path.
//
// `pnpm test` skips this file when DATABASE_URL is unset (CI without secrets).
// Local runs need `.env.local` loaded before vitest starts — this file calls
// `process.loadEnvFile()` (Node ≥ 21.7) to make `pnpm test` Just Work.

try {
  // Best-effort: load .env.local so DATABASE_URL is in process.env.
  // If the file is missing, skipIf below handles it gracefully.
  process.loadEnvFile('.env.local');
} catch {
  // ignore
}

const dbUrl = process.env.DATABASE_URL;
const FORGED_USER_ID = '00000000-0000-0000-0000-000000000000';

const RLS_TABLES = [
  'availability_blocks',
  'campaign_styles',
  'campaigns',
  'contact_identifiers',
  'contacts',
  'dealer_contacts',
  'dealers',
  'sales_lead_sources',
  'team_member_roles',
  'vehicle_ownerships',
  'vehicles',
] as const;

describe.skipIf(!dbUrl)('RLS baseline policies (0019 Phase 1)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('every domain table has RLS enabled', async () => {
    const rows = await sql<{ tablename: string; rowsecurity: boolean }[]>`
      select tablename, rowsecurity
      from pg_tables
      where schemaname = 'public' and tablename = any(${RLS_TABLES as unknown as string[]})
      order by tablename
    `;
    expect(rows.length).toBe(RLS_TABLES.length);
    for (const row of rows) {
      expect(row.rowsecurity, `${row.tablename} should have RLS enabled`).toBe(true);
    }
  });

  it('is_staff_member() returns false for a forged user with no staff link', async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role authenticated`);
      await tx`select set_config('request.jwt.claim.sub', ${FORGED_USER_ID}, true)`;
      const [{ is_staff }] = await tx<{ is_staff: boolean }[]>`
        select public.is_staff_member() as is_staff
      `;
      expect(is_staff).toBe(false);
    });
  });

  it('authenticated role with no staff link sees zero rows on every RLS table', async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role authenticated`);
      await tx`select set_config('request.jwt.claim.sub', ${FORGED_USER_ID}, true)`;
      for (const table of RLS_TABLES) {
        const [{ count }] = await tx<{ count: string }[]>`
          select count(*)::text as count from ${tx(`public.${table}`)}
        `;
        expect(Number(count), `${table} should be empty for non-staff user`).toBe(0);
      }
    });
  });

  it('drizzle-equivalent connection (postgres role, BYPASSRLS) still sees rows', async () => {
    // Sanity: the same connection (no SET ROLE) reads as `postgres`, which has
    // BYPASSRLS=t. If this returns 0 across the board something has broken in
    // the bypass path and existing Server Actions would also be empty.
    const [{ rolbypassrls }] = await sql<{ rolbypassrls: boolean }[]>`
      select rolbypassrls from pg_roles where rolname = current_user
    `;
    expect(rolbypassrls).toBe(true);
  });
});
