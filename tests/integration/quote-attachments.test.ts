import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres checks for the 0078 quote_attachments spine — the parts the
// mocked unit tests can't prove: the live table/columns exist, the loader's
// `ORDER BY display_order` actually sorts, a re-read returns the same persisted
// set (so a re-send re-attaches without re-uploading), and the `onDelete:
// cascade` FK really drops a quote's attachments with the quote.
//
// `pnpm test` skips when DATABASE_URL is unset (CI without secrets). Locally it
// runs against the dev DB inside a transaction that is ALWAYS rolled back, so it
// never leaves a stray dealer/quote/attachment behind. Single connection
// (`max: 1`) keeps it under the shared session-pooler client cap.

vi.mock('server-only', () => ({}));

import * as schema from '@/lib/db/schema';
import { dealers, quoteAttachments, quotes } from '@/lib/db/schema';

try {
  process.loadEnvFile('.env.local');
} catch {
  // missing file → skipIf below handles it
}
const dbUrl = process.env.DATABASE_URL;

describe.skipIf(!dbUrl)('quote_attachments persistence + cascade', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    client = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  // The tx handle drizzle hands the transaction callback (lacks `$client`, so
  // it isn't assignable to the full `db` type).
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  // The exact read `loadQuoteAttachments` / `sendQuote` issue, run inside the tx.
  function readAttachments(tx: Tx, quoteId: number) {
    return tx
      .select({
        id: quoteAttachments.id,
        filename: quoteAttachments.filename,
        contentType: quoteAttachments.contentType,
        byteSize: quoteAttachments.byteSize,
      })
      .from(quoteAttachments)
      .where(eq(quoteAttachments.quoteId, quoteId))
      .orderBy(asc(quoteAttachments.displayOrder), asc(quoteAttachments.id));
  }

  it('returns a quote\'s attachments in displayOrder; a re-read yields the same set (re-send re-attaches)', async () => {
    class Rollback extends Error {}
    let firstRead: Array<{ filename: string; byteSize: number }> = [];
    let secondRead: Array<{ filename: string }> = [];

    try {
      await db.transaction(async (tx) => {
        const [dealer] = await tx
          .insert(dealers)
          .values({ publicId: `qa-order-${Date.now()}`, name: 'QA Order Dealer' })
          .returning({ id: dealers.id });
        const [quote] = await tx
          .insert(quotes)
          .values({ dealerId: dealer.id, inputs: {} })
          .returning({ id: quotes.id });

        // Insert out of displayOrder to prove the ORDER BY (not insertion order).
        await tx.insert(quoteAttachments).values([
          {
            quoteId: quote.id,
            filename: 'second.png',
            storageKey: `quotes/${quote.id}/attachments/u2-second.png`,
            contentType: 'image/png',
            byteSize: 2000,
            displayOrder: 2,
          },
          {
            quoteId: quote.id,
            filename: 'first.pdf',
            storageKey: `quotes/${quote.id}/attachments/u1-first.pdf`,
            contentType: 'application/pdf',
            byteSize: 1000,
            displayOrder: 1,
          },
        ]);

        firstRead = await readAttachments(tx, quote.id);
        // A send only READS the set — re-reading returns the same rows, so a
        // re-send re-attaches the persisted documents without re-uploading.
        secondRead = await readAttachments(tx, quote.id);

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(firstRead.map((r) => r.filename)).toEqual(['first.pdf', 'second.png']);
    expect(firstRead.map((r) => r.byteSize)).toEqual([1000, 2000]);
    expect(secondRead.map((r) => r.filename)).toEqual(['first.pdf', 'second.png']);
  });

  it('cascades: deleting the parent quote drops its attachments', async () => {
    class Rollback extends Error {}
    let remaining = -1;

    try {
      await db.transaction(async (tx) => {
        const [dealer] = await tx
          .insert(dealers)
          .values({ publicId: `qa-cascade-${Date.now()}`, name: 'QA Cascade Dealer' })
          .returning({ id: dealers.id });
        const [quote] = await tx
          .insert(quotes)
          .values({ dealerId: dealer.id, inputs: {} })
          .returning({ id: quotes.id });
        await tx.insert(quoteAttachments).values({
          quoteId: quote.id,
          filename: 'doomed.pdf',
          storageKey: `quotes/${quote.id}/attachments/u-doomed.pdf`,
          contentType: 'application/pdf',
          byteSize: 500,
          displayOrder: 1,
        });

        await tx.delete(quotes).where(eq(quotes.id, quote.id));

        const left = await tx
          .select({ id: quoteAttachments.id })
          .from(quoteAttachments)
          .where(eq(quoteAttachments.quoteId, quote.id));
        remaining = left.length;

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(remaining).toBe(0);
  });
});
