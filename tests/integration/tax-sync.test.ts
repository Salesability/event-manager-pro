import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { taxRates } from '@/lib/db/schema';
import { applyTaxCodeSync } from '@/lib/quickbooks/tax-sync';
import type { QboTaxCode, QboTaxRate } from '@/lib/quickbooks/client';

// Integration test for `applyTaxCodeSync` (0074) against the real (seeded)
// `tax_rates`. Every case runs in an always-rolled-back transaction, so nothing
// persists. `applyTaxCodeSync` takes the QBO arrays directly (no network).
//
// `pnpm test` skips this file when DATABASE_URL is unset.

try {
  process.loadEnvFile('.env.local');
} catch {
  // skipIf handles a missing DATABASE_URL.
}

const dbUrl = process.env.DATABASE_URL;

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

// "HST ON" tax code → TaxRate #12 (13%). ON (seeded 13.000) is the only 13% rate.
const HST_ON: QboTaxCode = {
  Id: '5',
  Name: 'HST ON',
  Active: true,
  SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '12' } }] },
};
const RATES: QboTaxRate[] = [{ Id: '12', Name: 'HST ON', RateValue: 13 }];

describe.skipIf(!dbUrl)('applyTaxCodeSync (0074)', () => {
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

  it('links the 13% province (ON) to HST ON and leaves the rest unmatched', async () => {
    await inRolledBackTx(async (tx) => {
      const result = await applyTaxCodeSync([HST_ON], RATES, tx);

      const [on] = await tx.select().from(taxRates).where(eq(taxRates.province, 'ON'));
      expect(on.quickbooksTaxCodeId).toBe('5');
      expect(result.linked).toBe(1); // ON is the only 13% province
      expect(result.unmatched).toContain('QC'); // 14.975% — no matching code
    });
  });

  it('clears a stale link when no code matches the province rate', async () => {
    await inRolledBackTx(async (tx) => {
      // BC (12%) gets a stale link; the sync (only HST ON 13%) should null it.
      await tx.update(taxRates).set({ quickbooksTaxCodeId: '99' }).where(eq(taxRates.province, 'BC'));
      await applyTaxCodeSync([HST_ON], RATES, tx);

      const [bc] = await tx.select().from(taxRates).where(eq(taxRates.province, 'BC'));
      expect(bc.quickbooksTaxCodeId).toBeNull();
    });
  });
});
