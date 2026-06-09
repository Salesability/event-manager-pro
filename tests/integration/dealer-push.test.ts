import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { dealers } from '@/lib/db/schema';
import { type DealerToPush, pushDealerToQuickbooks } from '@/lib/quickbooks/dealer-push';
import { createCustomer, fetchCustomerById, updateCustomer } from '@/lib/quickbooks/client';

// Integration test for `pushDealerToQuickbooks` (0070 Phase 2) against a real
// DB. The QBO HTTP calls (createCustomer / fetchCustomerById / updateCustomer)
// are MOCKED — only the DB side (the `quickbooks_id` backfill + `updated_by_id`
// touch) hits Postgres, and every case runs inside an always-rolled-back
// transaction so nothing persists to the shared sandbox DB.
//
// `pnpm test` skips this file when DATABASE_URL is unset (CI without secrets).

vi.mock('server-only', () => ({}));
vi.mock('@/lib/quickbooks/client', () => ({
  createCustomer: vi.fn(),
  fetchCustomerById: vi.fn(),
  updateCustomer: vi.fn(),
}));

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore — skipIf below handles a missing DATABASE_URL gracefully.
}

const dbUrl = process.env.DATABASE_URL;
const tag = () => `__0070_test_${randomBytes(6).toString('hex')}__`;
const publicId = () => randomBytes(9).toString('base64url');
const qbId = () => `9${randomBytes(4).toString('hex')}`;

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('pushDealerToQuickbooks DB writes (0070 Phase 2)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  let actorId: string | null = null;

  beforeAll(async () => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    const users = await sql<{ id: string }[]>`select id from auth.users limit 1`;
    actorId = users[0]?.id ?? null;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(() => {
    vi.mocked(createCustomer).mockReset();
    vi.mocked(fetchCustomerById).mockReset();
    vi.mocked(updateCustomer).mockReset();
  });

  async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  it('create path: creates a QBO customer then backfills its Id onto the dealer', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const newQbId = qbId();
      vi.mocked(createCustomer).mockResolvedValue({ Id: newQbId, SyncToken: '0', DisplayName: name });

      const [seed] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: '1 King St', status: 'active' })
        .returning({ id: dealers.id });

      const dealer: DealerToPush = {
        id: seed.id, name, address: '1 King St', province: 'ON', quickbooksId: null,
      };
      const result = await pushDealerToQuickbooks(dealer, 'realm-1', 'access-1', actorId, tx);

      expect(result).toEqual({ action: 'created', qbId: newQbId });
      expect(vi.mocked(createCustomer)).toHaveBeenCalledTimes(1);
      const [, , payload] = vi.mocked(createCustomer).mock.calls[0];
      expect(payload.DisplayName).toBe(name);
      expect(payload.BillAddr).toEqual({ Line1: '1 King St', CountrySubDivisionCode: 'ON' });

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, seed.id));
      expect(row.quickbooksId).toBe(newQbId);
      if (actorId) expect(row.updatedById).toBe(actorId);
    });
  });

  it('update path: reads the current SyncToken then sparse-updates the linked customer', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const linkedQbId = qbId();
      vi.mocked(fetchCustomerById).mockResolvedValue({ Id: linkedQbId, SyncToken: '5' });
      vi.mocked(updateCustomer).mockResolvedValue({ Id: linkedQbId, SyncToken: '6' });

      const [seed] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: '2 Bay St', status: 'active', quickbooksId: linkedQbId })
        .returning({ id: dealers.id });

      const dealer: DealerToPush = {
        id: seed.id, name, address: '2 Bay St', province: 'BC', quickbooksId: linkedQbId,
      };
      const result = await pushDealerToQuickbooks(dealer, 'realm-1', 'access-1', actorId, tx);

      expect(result).toEqual({ action: 'updated', qbId: linkedQbId });
      expect(vi.mocked(fetchCustomerById)).toHaveBeenCalledWith('realm-1', 'access-1', linkedQbId);
      expect(vi.mocked(createCustomer)).not.toHaveBeenCalled();
      const [, , payload] = vi.mocked(updateCustomer).mock.calls[0];
      expect(payload.Id).toBe(linkedQbId);
      expect(payload.SyncToken).toBe('5'); // the freshly-read token, not a stored one

      // No duplicate dealer created; updated_by_id touched.
      const rows = await tx.select().from(dealers).where(eq(dealers.quickbooksId, linkedQbId));
      expect(rows).toHaveLength(1);
      if (actorId) expect(rows[0].updatedById).toBe(actorId);
    });
  });

  it('create path is guarded: a row already linked between load and write is not clobbered', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const existingQbId = qbId();
      const newQbId = qbId();
      vi.mocked(createCustomer).mockResolvedValue({ Id: newQbId, SyncToken: '0' });

      // The DB row is ALREADY linked (a concurrent push won the race), but the
      // in-memory dealer the caller loaded still shows quickbooksId === null.
      const [seed] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: '3 Pine St', status: 'active', quickbooksId: existingQbId })
        .returning({ id: dealers.id });

      const stale: DealerToPush = {
        id: seed.id, name, address: '3 Pine St', province: null, quickbooksId: null,
      };
      await pushDealerToQuickbooks(stale, 'realm-1', 'access-1', actorId, tx);

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, seed.id));
      expect(row.quickbooksId).toBe(existingQbId); // untouched — guard held
    });
  });
});
