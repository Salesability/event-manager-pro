// Throwaway fixture for the 0073 quote→QBO-Estimate push smoke. None of the
// existing sandbox quotes is push-ready (their lines reference the old catalog
// the sandbox "Pull items" purged, and their dealers aren't QBO-linked). This
// seeds ONE push-ready quote: an existing QBO-linked, non-archived dealer +
// `quote_line_items` referencing CURRENT linked SKUs (so every line has an
// ItemRef), status `accepted`. Then a human can click "Push to QuickBooks" on
// /quotes/<id> to create a real Estimate in the sandbox QBO company.
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0073-quote-push-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0073-quote-push-smoke.ts cleanup
//
// `cleanup` deletes the fixture quote (cascade-deletes its lines) by the marker
// in `inputs.smokeTag`. NOTE: if you already pushed it, the QBO Estimate stays
// in the sandbox company — delete it there too (sandbox, disposable).

import { and, asc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { dealers, quoteLineItems, quotes, serviceItems } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL');
  process.exit(1);
}

const SMOKE_TAG = '0073-quote-push-smoke';
const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0073-quote-push-smoke.ts <insert|cleanup>');
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

async function insert() {
  const [dealer] = await db
    .select({ id: dealers.id, name: dealers.name, qbId: dealers.quickbooksId })
    .from(dealers)
    .where(and(isNotNull(dealers.quickbooksId), isNull(dealers.archivedAt)))
    .orderBy(asc(dealers.id))
    .limit(1);
  if (!dealer) {
    console.error('No QBO-linked, non-archived dealer in sandbox — run Sync dealers first.');
    process.exit(1);
  }

  const skus = await db
    .select({ id: serviceItems.id, code: serviceItems.code, label: serviceItems.label, unitPrice: serviceItems.unitPrice })
    .from(serviceItems)
    .where(and(isNotNull(serviceItems.quickbooksId), isNull(serviceItems.archivedAt), isNotNull(serviceItems.unitPrice)))
    .orderBy(asc(serviceItems.id))
    .limit(2);
  if (skus.length === 0) {
    console.error('No QBO-linked priced service_items in sandbox — run Pull items first.');
    process.exit(1);
  }

  // Representative override prices so the Estimate has real dollar amounts +
  // non-zero tax — the QBO sample SKUs ("Services"/"Hours") are $0, which
  // wouldn't exercise line Amount or the TxnTaxDetail path. effectiveUnit uses
  // the override, so UnitPrice/Amount on the pushed Estimate are these.
  const OVERRIDES = ['125.00', '275.00', '90.00'];
  const lines = skus.map((s, i) => {
    const price = OVERRIDES[i] ?? '100.00';
    return { ...s, override: price, lineTotal: price }; // qty 1
  });
  const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  const tax = Math.round(subtotal * 13) / 100; // 13% — exercises TxnTaxDetail
  const total = subtotal + tax;

  const [q] = await db
    .insert(quotes)
    .values({
      dealerId: dealer.id,
      inputs: { quoteNotes: '0073 quote-push smoke — delete me', smokeTag: SMOKE_TAG },
      status: 'accepted',
      taxPct: '13.000',
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      total: total.toFixed(2),
    })
    .returning({ id: quotes.id });

  await db.insert(quoteLineItems).values(
    lines.map((l, i) => ({
      quoteId: q.id,
      serviceItemId: l.id,
      code: l.code,
      label: l.label,
      qty: 1,
      unitPrice: (l.unitPrice as string) ?? '0.00',
      overrideUnitPrice: l.override,
      lineTotal: l.lineTotal,
      displayOrder: i,
    })),
  );

  console.log(`Inserted push-ready quote id=${q.id}`);
  console.log(`  dealer: #${dealer.id} "${dealer.name}" [QB ${dealer.qbId}]`);
  console.log(`  lines: ${skus.map((s) => `${s.code} @ $${s.unitPrice}`).join(', ')}`);
  console.log(`  subtotal/total: $${subtotal.toFixed(2)} · tax $0`);
  console.log(`\nVisit /quotes/${q.id} and click "Push to QuickBooks" to create a real sandbox Estimate.`);
}

async function cleanup() {
  const rows = await db
    .delete(quotes)
    .where(sql`${quotes.inputs}->>'smokeTag' = ${SMOKE_TAG}`)
    .returning({ id: quotes.id, estimate: quotes.quickbooksEstimateId });
  console.log(`Deleted ${rows.length} fixture quote(s):`, rows);
  const pushed = rows.filter((r) => r.estimate);
  if (pushed.length) {
    console.log('NOTE: these were pushed — their QBO Estimates remain in the sandbox company:', pushed.map((r) => r.estimate));
  }
}

(async () => {
  try {
    if (arg === 'insert') await insert();
    else await cleanup();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
