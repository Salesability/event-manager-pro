import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { dealers, quotes } from '@/lib/db/schema';
import {
  type QuotePushDealer,
  type QuotePushLine,
  type QuotePushQuote,
  QuotePushNotReadyError,
  pushQuoteToQuickbooks,
} from '@/lib/quickbooks/quote-push';
import { createEstimate, fetchEstimateById, updateEstimate } from '@/lib/quickbooks/client';

// Integration test for `pushQuoteToQuickbooks` (0073). The QBO Estimate HTTP
// calls are MOCKED — only the DB side (the `quickbooks_estimate_id` backfill)
// hits Postgres, in always-rolled-back transactions.
//
// `pnpm test` skips this file when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/quickbooks/client', () => ({
  createEstimate: vi.fn(),
  updateEstimate: vi.fn(),
  fetchEstimateById: vi.fn(),
}));

try {
  process.loadEnvFile('.env.local');
} catch {
  // skipIf handles a missing DATABASE_URL.
}

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');
const estId = () => `E${randomBytes(4).toString('hex')}`;

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

const dealer = (over: Partial<QuotePushDealer> = {}): QuotePushDealer => ({
  id: 1,
  name: 'Acme Motors',
  quickbooksId: '42',
  ...over,
});
const line = (over: Partial<QuotePushLine> = {}): QuotePushLine => ({
  code: 'base-event',
  label: 'Base Event',
  qty: 1,
  unitPrice: '6900.00',
  overrideUnitPrice: null,
  lineTotal: '6900.00',
  itemQuickbooksId: '5',
  ...over,
});

describe.skipIf(!dbUrl)('pushQuoteToQuickbooks DB writes (0073)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  let dealerId = 1;

  beforeAll(async () => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(() => {
    vi.mocked(createEstimate).mockReset();
    vi.mocked(updateEstimate).mockReset();
    vi.mocked(fetchEstimateById).mockReset();
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

  // Seed a dealer + a quote, returning the quote id.
  async function seedQuote(tx: Tx, quickbooksEstimateId: string | null = null): Promise<number> {
    const [d] = await tx
      .insert(dealers)
      .values({ publicId: publicId(), name: '__0073 dealer__', status: 'active' })
      .returning({ id: dealers.id });
    dealerId = d.id;
    const [q] = await tx
      .insert(quotes)
      .values({ dealerId: d.id, inputs: {}, quickbooksEstimateId })
      .returning({ id: quotes.id });
    return q.id;
  }

  it('create path: creates an Estimate then backfills quickbooks_estimate_id', async () => {
    await inRolledBackTx(async (tx) => {
      const newId = estId();
      vi.mocked(createEstimate).mockResolvedValue({ Id: newId, SyncToken: '0', CustomerRef: { value: '42' }, Line: [] });
      const quoteId = await seedQuote(tx, null);

      const quote: QuotePushQuote = {
        id: quoteId,
        quickbooksEstimateId: null,
        subtotal: '6900.00',
        tax: '897.00', // 6900 × 13% = 897 → matches provinceRatePct
        taxCodeId: '5',
        provinceRatePct: '13.000',
        taxOverride: null,
      };
      const result = await pushQuoteToQuickbooks(
        quote,
        [line({ itemQuickbooksId: '7' })],
        dealer({ id: dealerId, quickbooksId: '42' }),
        'realm-1',
        'access-1',
        tx,
      );

      expect(result).toEqual({ action: 'created', estimateId: newId });
      const [, , payload] = vi.mocked(createEstimate).mock.calls[0];
      expect(payload.CustomerRef.value).toBe('42');
      expect(payload.Line[0].SalesItemLineDetail?.ItemRef.value).toBe('7');
      // tax goes via a PER-LINE TaxCodeRef (0074 — QBO Canada requires it), not a
      // txn-level code or a TotalTax override
      expect(payload.Line[0].SalesItemLineDetail?.TaxCodeRef).toEqual({ value: '5' });
      expect(payload.TxnTaxDetail).toBeUndefined();

      const [row] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
      expect(row.quickbooksEstimateId).toBe(newId);
    });
  });

  it('update path: reads the SyncToken then sparse-updates the linked Estimate', async () => {
    await inRolledBackTx(async (tx) => {
      const linkedId = estId();
      vi.mocked(fetchEstimateById).mockResolvedValue({ Id: linkedId, SyncToken: '5', CustomerRef: { value: '42' }, Line: [] });
      vi.mocked(updateEstimate).mockResolvedValue({ Id: linkedId, SyncToken: '6', CustomerRef: { value: '42' }, Line: [] });
      const quoteId = await seedQuote(tx, linkedId);

      const quote: QuotePushQuote = {
        id: quoteId,
        quickbooksEstimateId: linkedId,
        subtotal: '6900.00',
        tax: '0',
        taxCodeId: null,
        provinceRatePct: null,
        taxOverride: null,
      };
      const result = await pushQuoteToQuickbooks(
        quote,
        [line()],
        dealer({ id: dealerId }),
        'realm-1',
        'access-1',
        tx,
      );

      expect(result).toEqual({ action: 'updated', estimateId: linkedId });
      expect(vi.mocked(fetchEstimateById)).toHaveBeenCalledWith('realm-1', 'access-1', linkedId);
      expect(vi.mocked(createEstimate)).not.toHaveBeenCalled();
      const [, , payload] = vi.mocked(updateEstimate).mock.calls[0];
      expect(payload.SyncToken).toBe('5'); // freshly read, not stored
    });
  });

  it('pre-flight: unlinked dealer or SKU throws QuotePushNotReadyError and writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const quoteId = await seedQuote(tx, null);
      const quote: QuotePushQuote = {
        id: quoteId,
        quickbooksEstimateId: null,
        subtotal: '0',
        tax: '0',
        taxCodeId: null,
        provinceRatePct: null,
        taxOverride: null,
      };

      // Unlinked dealer.
      await expect(
        pushQuoteToQuickbooks(quote, [line()], dealer({ id: dealerId, quickbooksId: null }), 'r', 'a', tx),
      ).rejects.toBeInstanceOf(QuotePushNotReadyError);

      // Linked dealer but an unlinked line SKU.
      await expect(
        pushQuoteToQuickbooks(
          quote,
          [line({ itemQuickbooksId: null })],
          dealer({ id: dealerId, quickbooksId: '42' }),
          'r',
          'a',
          tx,
        ),
      ).rejects.toBeInstanceOf(QuotePushNotReadyError);

      expect(vi.mocked(createEstimate)).not.toHaveBeenCalled();
      const [row] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
      expect(row.quickbooksEstimateId).toBeNull(); // untouched
    });
  });
});
