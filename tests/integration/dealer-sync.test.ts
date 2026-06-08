import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { dealers } from '@/lib/db/schema';
import { applyDealerSync, mapCustomerToDealer } from '@/lib/quickbooks/dealer-sync';
import type { QboCustomer } from '@/lib/quickbooks/client';

// Integration test for `applyDealerSync` (0069 Phase 2) against a real DB.
// Every case runs inside a transaction that is ALWAYS rolled back, so nothing
// persists to the shared sandbox DB. Synthetic customers use unique tagged
// names so they can never match real dealers (and real dealers — which the
// loader reads — are never written, since only the passed customers are acted
// on).
//
// `pnpm test` skips this file when DATABASE_URL is unset (CI without secrets).

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore — skipIf below handles a missing DATABASE_URL gracefully.
}

const dbUrl = process.env.DATABASE_URL;
const tag = () => `__0069_test_${randomBytes(6).toString('hex')}__`;
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('applyDealerSync precedence (0069 Phase 2)', () => {
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

  // Run `fn` inside a transaction and always roll back. Assertion failures
  // (not our Rollback sentinel) still propagate and fail the test.
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

  it('inserts a fresh dealer stamped with the QB id (sandbox path)', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const qbId = `9${randomBytes(4).toString('hex')}`;
      const customers: QboCustomer[] = [
        { Id: qbId, CompanyName: name, BillAddr: { Line1: '1 New St', CountrySubDivisionCode: 'ON' } },
      ];
      const result = await applyDealerSync(customers, actorId, tx);
      expect(result).toMatchObject({ created: 1, linked: 0, alreadyLinked: 0, skipped: 0 });

      const [row] = await tx.select().from(dealers).where(eq(dealers.quickbooksId, qbId));
      expect(row).toBeTruthy();
      expect(row.name).toBe(name);
      expect(row.province).toBe('ON');
      expect(row.acquiredVia).toBe('QuickBooks sync');
      expect(row.status).toBe('active');
      if (actorId) expect(row.createdById).toBe(actorId);
    });
  });

  it('backfills the QB id + null province onto a name+address match (prod path)', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const qbId = `9${randomBytes(4).toString('hex')}`;
      const customer: QboCustomer = { Id: qbId, CompanyName: name, BillAddr: { Line1: '9 Bay St', CountrySubDivisionCode: 'BC' } };
      // Seed the dealer exactly as the 0060 import would have (same
      // formatAddress), but province-less + unlinked — the prod backfill case.
      const mapped = mapCustomerToDealer(customer);
      const [seed] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: mapped.address, status: 'active' })
        .returning({ id: dealers.id });

      const result = await applyDealerSync([customer], actorId, tx);
      expect(result).toMatchObject({ created: 0, linked: 1, skipped: 0 });

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, seed.id));
      expect(row.quickbooksId).toBe(qbId);
      expect(row.province).toBe('BC'); // backfilled (was null)
      expect(row.name).toBe(name); // never clobbered
      expect(row.address).toBe(mapped.address); // never clobbered
    });
  });

  it('never clobbers an existing province on backfill', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const qbId = `9${randomBytes(4).toString('hex')}`;
      const customer: QboCustomer = { Id: qbId, CompanyName: name, BillAddr: { Line1: '5 Elm St', CountrySubDivisionCode: 'BC' } };
      const mapped = mapCustomerToDealer(customer);
      const [seed] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: mapped.address, province: 'ON', status: 'active' })
        .returning({ id: dealers.id });

      await applyDealerSync([customer], actorId, tx);

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, seed.id));
      expect(row.quickbooksId).toBe(qbId);
      expect(row.province).toBe('ON'); // unchanged — never clobbered
    });
  });

  it('is a no-op on an already-linked dealer and idempotent on re-run', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const qbId = `9${randomBytes(4).toString('hex')}`;
      await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: '7 Oak St', status: 'active', quickbooksId: qbId });

      const customers: QboCustomer[] = [
        { Id: qbId, CompanyName: name, BillAddr: { Line1: '7 Oak St' } },
      ];
      const first = await applyDealerSync(customers, actorId, tx);
      expect(first).toMatchObject({ created: 0, linked: 0, alreadyLinked: 1, skipped: 0 });

      const second = await applyDealerSync(customers, actorId, tx);
      expect(second).toMatchObject({ created: 0, alreadyLinked: 1 });

      const rows = await tx.select().from(dealers).where(eq(dealers.quickbooksId, qbId));
      expect(rows).toHaveLength(1); // no duplicate inserted
    });
  });

  it('skips a name+address match already linked to a different QB id', async () => {
    await inRolledBackTx(async (tx) => {
      const name = tag();
      const otherQbId = `9${randomBytes(4).toString('hex')}`;
      const customer: QboCustomer = { Id: otherQbId, CompanyName: name, BillAddr: { Line1: '3 Pine St' } };
      const mapped = mapCustomerToDealer(customer);
      const existingQbId = `9${randomBytes(4).toString('hex')}`;
      const [seed] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: mapped.address, status: 'active', quickbooksId: existingQbId })
        .returning({ id: dealers.id });

      const result = await applyDealerSync([customer], actorId, tx);
      expect(result).toMatchObject({ created: 0, linked: 0, skipped: 1 });

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, seed.id));
      expect(row.quickbooksId).toBe(existingQbId); // untouched
    });
  });
});
