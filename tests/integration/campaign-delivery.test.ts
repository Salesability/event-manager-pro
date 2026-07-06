import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres check for the 0094 accept-time snapshot: `applyAcceptedQuoteToCampaign`
// reads an accepted quote's line items, derives the four delivery metrics, and
// writes them (+ `accepted_quote_id`) onto the quote's campaign — overwriting any
// prior hand-entered values (D3 backfill-all semantics also govern the live write).
// The pure mapping is unit-tested (`src/lib/quotes/delivery-metrics.test.ts`); this
// proves the DB round-trip (line-item read → campaign UPDATE) on real Postgres.
//
// Every case runs inside an always-rolled-back transaction (the real function is
// called with the tx handle via its injectable executor), so nothing persists to
// the shared sandbox DB. `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

import * as schema from '@/lib/db/schema';
import { campaigns, dealers, quoteLineItems, quotes } from '@/lib/db/schema';
import { applyAcceptedQuoteToCampaign } from '@/features/quotes/campaign-delivery';

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

describe.skipIf(!dbUrl)('applyAcceptedQuoteToCampaign — accept-time delivery snapshot (0094)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function seedCampaign(tx: Tx, dealerId: number, old: Partial<{ qtyRecords: number; smsEmail: number; letters: number; bdc: number }>) {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        publicId: publicId(),
        dealerId,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        ...old,
      })
      .returning({ id: campaigns.id });
    return campaign.id;
  }

  async function addLine(tx: Tx, quoteId: number, code: string, qty: number, order: number) {
    await tx.insert(quoteLineItems).values({
      quoteId,
      code,
      label: code,
      qty,
      unitPrice: '1.00',
      lineTotal: String(qty),
      displayOrder: order,
    });
  }

  it('derives the four metrics from line items and overwrites the campaign (+ sets accepted_quote_id)', async () => {
    let row: { qtyRecords: number | null; smsEmail: number | null; letters: number | null; bdc: number | null; acceptedQuoteId: number | null } | undefined;
    let expectedQuoteId = -1;

    try {
      await db.transaction(async (tx) => {
        const [dealer] = await tx
          .insert(dealers)
          .values({ publicId: publicId(), name: 'Delivery Snapshot Dealer' })
          .returning({ id: dealers.id });
        // Campaign starts with stale hand-entered numbers to prove the overwrite.
        const campaignId = await seedCampaign(tx, dealer.id, {
          qtyRecords: 111,
          smsEmail: 222,
          letters: 333,
          bdc: 444,
        });
        const [quote] = await tx
          .insert(quotes)
          .values({ dealerId: dealer.id, inputs: {}, status: 'accepted', campaignId })
          .returning({ id: quotes.id });
        expectedQuoteId = quote.id;

        // base 500 + 250 additional = 750 records; sms 400; letters 400; bdc 30;
        // travel + additional-day contribute nothing.
        await addLine(tx, quote.id, 'base-event', 1, 0);
        await addLine(tx, quote.id, 'additional-contact', 250, 1);
        await addLine(tx, quote.id, 'digital-record', 400, 2);
        await addLine(tx, quote.id, 'letter-postage', 400, 3);
        await addLine(tx, quote.id, 'bdc-call', 30, 4);
        await addLine(tx, quote.id, 'travel', 1, 5);

        await applyAcceptedQuoteToCampaign(quote.id, null, tx);

        [row] = await tx
          .select({
            qtyRecords: campaigns.qtyRecords,
            smsEmail: campaigns.smsEmail,
            letters: campaigns.letters,
            bdc: campaigns.bdc,
            acceptedQuoteId: campaigns.acceptedQuoteId,
          })
          .from(campaigns)
          .where(eq(campaigns.id, campaignId));

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(row).toBeDefined();
    expect(row).toEqual({
      qtyRecords: 750,
      smsEmail: 400,
      letters: 400,
      bdc: 30,
      acceptedQuoteId: expectedQuoteId,
    });
  });

  it('writes zeros for a quote with no contributing line items', async () => {
    let row: { qtyRecords: number | null; bdc: number | null } | undefined;

    try {
      await db.transaction(async (tx) => {
        const [dealer] = await tx
          .insert(dealers)
          .values({ publicId: publicId(), name: 'Empty Quote Dealer' })
          .returning({ id: dealers.id });
        const campaignId = await seedCampaign(tx, dealer.id, { qtyRecords: 999, bdc: 999 });
        const [quote] = await tx
          .insert(quotes)
          .values({ dealerId: dealer.id, inputs: {}, status: 'accepted', campaignId })
          .returning({ id: quotes.id });
        // Only a non-mapping line — nothing contributes to a metric.
        await addLine(tx, quote.id, 'record-retrieval', 1, 0);

        await applyAcceptedQuoteToCampaign(quote.id, null, tx);

        [row] = await tx
          .select({ qtyRecords: campaigns.qtyRecords, bdc: campaigns.bdc })
          .from(campaigns)
          .where(eq(campaigns.id, campaignId));

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(row).toEqual({ qtyRecords: 0, bdc: 0 });
  });

  it('is a no-op for a quote with no campaign link (legacy pre-0093 row)', async () => {
    let threw = false;
    try {
      await db.transaction(async (tx) => {
        const [dealer] = await tx
          .insert(dealers)
          .values({ publicId: publicId(), name: 'No Campaign Dealer' })
          .returning({ id: dealers.id });
        const [quote] = await tx
          .insert(quotes)
          .values({ dealerId: dealer.id, inputs: {}, status: 'accepted' })
          .returning({ id: quotes.id });
        await addLine(tx, quote.id, 'bdc-call', 5, 0);

        // Must not throw even though there's no campaign to write onto.
        await applyAcceptedQuoteToCampaign(quote.id, null, tx);

        throw new Rollback();
      });
    } catch (err) {
      if (err instanceof Rollback) threw = true;
      else throw err;
    }
    expect(threw).toBe(true);
  });
});
