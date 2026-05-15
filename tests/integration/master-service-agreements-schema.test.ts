import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Thin schema-reachability test for `master_service_agreements` (0037 Phase 2).
// Confirms the table exists and the `msa_status` enum has the expected values.
// Full action-level tests land in 7.2 (sign / status-transition flows).
//
// `pnpm test` skips when DATABASE_URL is unset (CI without secrets).

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore
}

const dbUrl = process.env.DATABASE_URL;

describe.skipIf(!dbUrl)('master_service_agreements schema (0037 Phase 2)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('table is reachable in the public schema', async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename
      from pg_tables
      where schemaname = 'public' and tablename = 'master_service_agreements'
    `;
    expect(rows).toHaveLength(1);
  });

  it('msa_status enum exposes pending|active|expired|terminated', async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'msa_status'
      order by e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual([
      'pending',
      'active',
      'expired',
      'terminated',
    ]);
  });

  it('master_service_agreements has the expected columns', async () => {
    const rows = await sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'master_service_agreements'
      order by column_name
    `;
    expect(rows.map((r) => r.column_name)).toEqual([
      'created_at',
      'created_by_id',
      'dealer_id',
      'expires_at',
      'id',
      'provider_document_id',
      'signed_at',
      'signed_pdf_storage_key',
      'status',
      'template_version',
      'termination_effective_date',
      'termination_notice_date',
      'updated_at',
      'updated_by_id',
    ]);
  });
});
