import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres check for the 0100 per-event MSA waiver:
//  - `isAcceptMsaSatisfied` — the executor-injectable core of the `acceptQuote`
//    MSA gate: a waived event accepts with no active MSA; a non-waived one still
//    requires a live active MSA (0082 unchanged).
//  - the guarded `campaigns.msa_waived` UPDATE the `setMsaWaived` action relies
//    on (flips the flag; a bad id updates 0 rows).
//
// Every case runs inside an always-rolled-back transaction (the function is
// called with the tx handle), so nothing persists to the shared sandbox DB.
// `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

import * as schema from '@/lib/db/schema';
import { campaigns, dealers, masterServiceAgreements } from '@/lib/db/schema';
import { isAcceptMsaSatisfied } from '@/features/quotes/accept-gate';

try {
  process.loadEnvFile('.env.local');
} catch {
  // missing file → skipIf below handles it
}

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('MSA waiver — accept gate + campaign flag (0100)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function seedDealer(tx: Tx, name: string) {
    const [dealer] = await tx
      .insert(dealers)
      .values({ publicId: publicId(), name })
      .returning({ id: dealers.id });
    return dealer.id;
  }

  async function seedCampaign(tx: Tx, dealerId: number, msaWaived: boolean) {
    const [c] = await tx
      .insert(campaigns)
      .values({
        publicId: publicId(),
        dealerId,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        msaWaived,
      })
      .returning({ id: campaigns.id });
    return c.id;
  }

  async function seedActiveMsa(tx: Tx, dealerId: number, expiresAt: Date) {
    await tx
      .insert(masterServiceAgreements)
      .values({ dealerId, status: 'active', expiresAt, templateVersion: 'test' });
  }

  const future = () => new Date(Date.now() + 365 * 86_400_000);
  const past = () => new Date(Date.now() - 86_400_000);

  // Run `fn` inside a transaction that always rolls back; return its value.
  async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let out: T | undefined;
    try {
      await db.transaction(async (tx) => {
        out = await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    return out as T;
  }

  describe('isAcceptMsaSatisfied (the acceptQuote MSA gate)', () => {
    it('a WAIVED event is satisfied even with no active MSA', async () => {
      const result = await inTx(async (tx) => {
        const dealerId = await seedDealer(tx, 'Waived Dealer');
        const campaignId = await seedCampaign(tx, dealerId, true);
        return isAcceptMsaSatisfied(dealerId, campaignId, tx);
      });
      expect(result).toBe(true);
    });

    it('a NON-waived event with no active MSA is NOT satisfied (gate blocks)', async () => {
      const result = await inTx(async (tx) => {
        const dealerId = await seedDealer(tx, 'Bare Dealer');
        const campaignId = await seedCampaign(tx, dealerId, false);
        return isAcceptMsaSatisfied(dealerId, campaignId, tx);
      });
      expect(result).toBe(false);
    });

    it('a NON-waived event WITH a live active MSA is satisfied (0082 unchanged)', async () => {
      const result = await inTx(async (tx) => {
        const dealerId = await seedDealer(tx, 'Active MSA Dealer');
        const campaignId = await seedCampaign(tx, dealerId, false);
        await seedActiveMsa(tx, dealerId, future());
        return isAcceptMsaSatisfied(dealerId, campaignId, tx);
      });
      expect(result).toBe(true);
    });

    it('an EXPIRED active MSA does not satisfy a non-waived event', async () => {
      const result = await inTx(async (tx) => {
        const dealerId = await seedDealer(tx, 'Expired MSA Dealer');
        const campaignId = await seedCampaign(tx, dealerId, false);
        await seedActiveMsa(tx, dealerId, past());
        return isAcceptMsaSatisfied(dealerId, campaignId, tx);
      });
      expect(result).toBe(false);
    });

    it('a quote with NO campaign link falls through to the normal active-MSA gate', async () => {
      const { withoutMsa, withMsa } = await inTx(async (tx) => {
        const dealerId = await seedDealer(tx, 'No-Campaign Dealer');
        const withoutMsa = await isAcceptMsaSatisfied(dealerId, null, tx);
        await seedActiveMsa(tx, dealerId, future());
        const withMsa = await isAcceptMsaSatisfied(dealerId, null, tx);
        return { withoutMsa, withMsa };
      });
      expect(withoutMsa).toBe(false); // no waiver to inherit, no MSA → blocked
      expect(withMsa).toBe(true); // normal active-MSA path still satisfies
    });
  });

  describe('campaigns.msa_waived UPDATE (setMsaWaived guarded update)', () => {
    it('flips the flag and returns the row; a bad id updates 0 rows', async () => {
      const { flipped, badId } = await inTx(async (tx) => {
        const dealerId = await seedDealer(tx, 'Flag Dealer');
        const campaignId = await seedCampaign(tx, dealerId, false);
        const flipped = await tx
          .update(campaigns)
          .set({ msaWaived: true })
          .where(eq(campaigns.id, campaignId))
          .returning({ id: campaigns.id, msaWaived: campaigns.msaWaived });
        const badId = await tx
          .update(campaigns)
          .set({ msaWaived: true })
          .where(eq(campaigns.id, -1))
          .returning({ id: campaigns.id });
        return { flipped, badId };
      });
      expect(flipped).toEqual([{ id: expect.any(Number), msaWaived: true }]);
      expect(badId).toEqual([]);
    });
  });
});
