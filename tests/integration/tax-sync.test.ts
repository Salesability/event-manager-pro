import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { taxRates } from '@/lib/db/schema';
import { applyTaxCodeSync } from '@/lib/quickbooks/tax-sync';
import type { QboTaxCode, QboTaxRate } from '@/lib/quickbooks/client';

// Integration test for `applyTaxCodeSync` (0075 — QB is the tax-rate source of
// truth) against the real (seeded) `tax_rates`. Verifies name-matching + rate
// ADOPTION: a province is matched to the QBO TaxCode whose name identifies it and
// takes that code's rate. Every case runs in an always-rolled-back transaction,
// so nothing persists. `applyTaxCodeSync` takes the QBO arrays directly (no
// network). `pnpm test` skips this file when DATABASE_URL is unset.

try {
  process.loadEnvFile('.env.local');
} catch {
  // skipIf handles a missing DATABASE_URL.
}

const dbUrl = process.env.DATABASE_URL;

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

// "HST ON" tax code → TaxRate #12 (13%). Its NAME ("HST ON") identifies Ontario;
// the sync adopts its 13% rate into `tax_rates.rate` for ON.
const HST_ON: QboTaxCode = {
  Id: '5',
  Name: 'HST ON',
  Active: true,
  SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '12' } }] },
};
const RATES: QboTaxRate[] = [{ Id: '12', Name: 'HST ON', RateValue: 13 }];

describe.skipIf(!dbUrl)('applyTaxCodeSync (0075 — name match + rate adoption)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
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

  it('name-matches ON to HST ON, ADOPTS its rate, and leaves the rest unmanaged', async () => {
    await inRolledBackTx(async (tx) => {
      // Force ON off QB's rate first, to prove the sync pulls 13% back in.
      await tx.update(taxRates).set({ rate: '11.000' }).where(eq(taxRates.province, 'ON'));

      const result = await applyTaxCodeSync([HST_ON], RATES, tx);

      const [on] = await tx.select().from(taxRates).where(eq(taxRates.province, 'ON'));
      expect(on.quickbooksTaxCodeId).toBe('5'); // name-matched "HST ON" → ON
      expect(on.rate).toBe('13.000'); // adopted QB's rate (was forced to 11.000)
      expect(result.linked).toBe(1); // ON is the only province HST ON names
      expect(result.unmatched).toContain('QC'); // no code names QC → kept app-managed
    });
  });

  it('keeps an unmanaged province’s app rate while clearing a stale code link', async () => {
    await inRolledBackTx(async (tx) => {
      // BC gets a stale link; only "HST ON" is synced (names no other province),
      // so BC must lose the link but keep its seeded rate.
      const [before] = await tx.select().from(taxRates).where(eq(taxRates.province, 'BC'));
      await tx.update(taxRates).set({ quickbooksTaxCodeId: '99' }).where(eq(taxRates.province, 'BC'));

      await applyTaxCodeSync([HST_ON], RATES, tx);

      const [bc] = await tx.select().from(taxRates).where(eq(taxRates.province, 'BC'));
      expect(bc.quickbooksTaxCodeId).toBeNull();
      expect(bc.rate).toBe(before.rate); // app rate untouched (fallback)
    });
  });
});
