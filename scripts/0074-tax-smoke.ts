// Throwaway fixture for the 0074 tax smoke (CA sandbox). Builds a push-ready
// ONTARIO quote so a human can push it and confirm the QBO Estimate carries a
// 13% HST line (the tax-alignment payoff). The CA company's catalog is all
// non-syncable sub-items, so we hand-link one real CA Item (#8 "Gold party",
// $2000 — a sub-item, which our sync skips but QBO accepts as a line ItemRef).
//
// Picks an ON-province, CA-linked dealer (province ON → tax_rates → HST ON code).
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0074-tax-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0074-tax-smoke.ts cleanup
//
// cleanup deletes the fixture quote (cascade lines) + the hand-linked smoke SKU.
// NOTE: a pushed Estimate stays in the CA sandbox company — delete it there too.

import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { dealers, quoteLineItems, quotes, serviceItems } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL');
  process.exit(1);
}
const SMOKE_TAG = '0074-tax-smoke';
const SMOKE_SKU = 'zzz-0074-smoke';
const CA_ITEM_ID = '8'; // CA company "Gold party" $2000 (Service, sub-item)
const CA_ITEM_LABEL = 'Gold party';
const PRICE = '2000.00';

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0074-tax-smoke.ts <insert|cleanup>');
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

async function insert() {
  const [dealer] = await db
    .select({ id: dealers.id, name: dealers.name, qbId: dealers.quickbooksId })
    .from(dealers)
    .where(and(eq(dealers.province, 'ON'), isNotNull(dealers.quickbooksId)))
    .orderBy(asc(dealers.id))
    .limit(1);
  if (!dealer) {
    console.error('No ON-province, CA-linked dealer — run Sync dealers against the CA company first.');
    process.exit(1);
  }

  // Hand-link the CA item as a SKU (reuse if a prior run left it).
  let [sku] = await db
    .select({ id: serviceItems.id })
    .from(serviceItems)
    .where(eq(serviceItems.code, SMOKE_SKU))
    .limit(1);
  if (!sku) {
    [sku] = await db
      .insert(serviceItems)
      .values({ code: SMOKE_SKU, label: CA_ITEM_LABEL, unitPrice: PRICE, quickbooksId: CA_ITEM_ID })
      .returning({ id: serviceItems.id });
  }

  const subtotal = Number(PRICE); // qty 1
  const tax = Math.round(subtotal * 13) / 100; // ON 13%
  const total = subtotal + tax;
  const [q] = await db
    .insert(quotes)
    .values({
      dealerId: dealer.id,
      inputs: { quoteNotes: '0074 tax smoke — delete me', smokeTag: SMOKE_TAG },
      status: 'accepted',
      taxPct: '13.000',
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      total: total.toFixed(2),
    })
    .returning({ id: quotes.id });

  await db.insert(quoteLineItems).values({
    quoteId: q.id,
    serviceItemId: sku.id,
    code: SMOKE_SKU,
    label: CA_ITEM_LABEL,
    qty: 1,
    unitPrice: PRICE,
    lineTotal: PRICE,
    displayOrder: 0,
  });

  console.log(`Inserted ON tax-smoke quote id=${q.id}`);
  console.log(`  dealer: #${dealer.id} "${dealer.name}" [QB customer ${dealer.qbId}] province=ON`);
  console.log(`  line: "${CA_ITEM_LABEL}" [QB item ${CA_ITEM_ID}] $${PRICE} × 1`);
  console.log(`  subtotal $${subtotal.toFixed(2)} · tax (13% HST ON) $${tax.toFixed(2)} · total $${total.toFixed(2)}`);
  console.log(`\nVisit /quotes/${q.id} and click "Push to QuickBooks". Then open the Estimate in the CA company and check the Tax line.`);
}

async function cleanup() {
  const qs = await db
    .delete(quotes)
    .where(sql`${quotes.inputs}->>'smokeTag' = ${SMOKE_TAG}`)
    .returning({ id: quotes.id, estimate: quotes.quickbooksEstimateId });
  const sk = await db.delete(serviceItems).where(eq(serviceItems.code, SMOKE_SKU)).returning({ id: serviceItems.id });
  console.log(`Deleted ${qs.length} quote(s), ${sk.length} smoke SKU(s).`);
  const pushed = qs.filter((r) => r.estimate);
  if (pushed.length) console.log('NOTE: pushed Estimates remain in the CA sandbox:', pushed.map((r) => r.estimate));
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
