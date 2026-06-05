import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Regression test for the quote-PDF line-item correlation bug (2026-06-05):
// `renderLinesColumn` had `where li.quote_id = ${quotes.id}`, which Drizzle
// rendered as bare `"id"` (unqualified). Inside the subquery that bound to
// `quote_line_items.id`, so the correlation silently became `li.quote_id =
// li.id` and the PDF dropped every line whose row id ≠ its quote_id. Only a
// REAL Postgres surfaces this (the unit tests mock the DB), so this lives here.
//
// `pnpm test` skips when DATABASE_URL is unset (CI without secrets). Locally it
// runs against the dev DB inside a transaction that is ALWAYS rolled back, so it
// never leaves a stray dealer/quote behind.

vi.mock('server-only', () => ({})); // render-lines.ts imports it

import * as schema from '@/lib/db/schema';
import { dealers, quoteLineItems, quotes } from '@/lib/db/schema';
import { mapRenderLines, renderLinesColumn } from '@/lib/quotes/render-lines';

try {
  process.loadEnvFile('.env.local');
} catch {
  // missing file → skipIf below handles it
}
const dbUrl = process.env.DATABASE_URL;

describe.skipIf(!dbUrl)('renderLinesColumn correlates to the outer quote id', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    client = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it('returns every line item for a quote (was li.quote_id = li.id)', async () => {
    // Sentinel to force the surrounding transaction to roll back after we read.
    class Rollback extends Error {}
    let count = -1;

    try {
      await db.transaction(async (tx) => {
        const [dealer] = await tx
          .insert(dealers)
          .values({ publicId: `render-lines-test-${Date.now()}`, name: 'RenderLines Test Dealer' })
          .returning({ id: dealers.id });
        const [quote] = await tx
          .insert(quotes)
          .values({ dealerId: dealer.id, inputs: {} })
          .returning({ id: quotes.id });
        await tx.insert(quoteLineItems).values([
          { quoteId: quote.id, code: 'a', label: 'Line A', qty: 1, unitPrice: '60.00', lineTotal: '60.00', displayOrder: 0 },
          { quoteId: quote.id, code: 'b', label: 'Line B', qty: 1, unitPrice: '40.00', lineTotal: '40.00', displayOrder: 1 },
        ]);

        // The exact query previewQuotePdf / sendQuote run.
        const [row] = await tx
          .select({ renderLines: renderLinesColumn })
          .from(quotes)
          .where(eq(quotes.id, quote.id))
          .limit(1);
        count = mapRenderLines(row.renderLines).length;

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(count).toBe(2);
  });
});
