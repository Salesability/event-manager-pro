// 0100 chunk-end browser smoke fixture: seeds two booked events so the per-event
// MSA-waiver surface can be eyeballed in both states without wiring a real
// waive-toggle / quote-accept flow:
//   • a WAIVED event  — `campaigns.msa_waived = true` + an accepted quote, NO MSA
//     → MSA row reads "Not required" (neutral zinc pill), no "⚠ Commercially
//     exposed" banner (accepted quote + waiver satisfy both dimensions), and
//     NO "Send MSA" CTA.
//   • a CONTROL event — non-waived, no MSA, no quote (0093's "exposed" shape)
//     → amber ribbon dot, "No active MSA" row + "⚠ Commercially exposed" banner
//     + Create-Quote / Send-MSA CTAs. Proves the waiver is opt-in, not global.
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0100-msa-waived-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0100-msa-waived-smoke.ts cleanup
//
// `cleanup` is idempotent (deletes by the FIXTURE_MARKER tag regardless of
// whether the rows exist), and respects FK order: quotes → campaigns → dealers.

import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { campaigns, dealers, quotes } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local first)');
  process.exit(1);
}

const FIXTURE_MARKER = '0100-waived-smoke';

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0100-msa-waived-smoke.ts <insert|cleanup>');
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

// A few days out so they land on the visible calendar grid.
function isoFromToday(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

async function insert() {
  console.log('Seeding 0100 MSA-waiver fixtures…');

  // WAIVED dealer: no MSA at all; the event is waived + has an accepted quote.
  const [waivedDealer] = await db
    .insert(dealers)
    .values({
      publicId: `${FIXTURE_MARKER}-waived`,
      name: `${FIXTURE_MARKER} Waived Motors`,
      status: 'active',
    })
    .returning({ id: dealers.id });

  // CONTROL dealer: no MSA, no quote — a plain "exposed / No active MSA" event.
  const [controlDealer] = await db
    .insert(dealers)
    .values({
      publicId: `${FIXTURE_MARKER}-control`,
      name: `${FIXTURE_MARKER} Control Auto`,
      status: 'active',
    })
    .returning({ id: dealers.id });

  const [waivedCampaign] = await db
    .insert(campaigns)
    .values({
      publicId: `${FIXTURE_MARKER}-waived-evt`,
      dealerId: waivedDealer.id,
      status: 'booked',
      startDate: isoFromToday(3),
      endDate: isoFromToday(4),
      msaWaived: true,
    })
    .returning({ id: campaigns.id });

  // Accepted quote so the quote dimension is satisfied too — with the waiver,
  // the event reads fully "Protected" (green banner, no amber) and never nags.
  await db.insert(quotes).values({
    dealerId: waivedDealer.id,
    campaignId: waivedCampaign.id,
    status: 'accepted',
    inputs: {},
  });

  const [controlCampaign] = await db
    .insert(campaigns)
    .values({
      publicId: `${FIXTURE_MARKER}-control-evt`,
      dealerId: controlDealer.id,
      status: 'booked',
      startDate: isoFromToday(5),
      endDate: isoFromToday(6),
      msaWaived: false,
    })
    .returning({ id: campaigns.id });

  console.log(`  waived event  #${waivedCampaign.id} (msa_waived=true + accepted quote, NO MSA)`);
  console.log(`  control event #${controlCampaign.id} (non-waived, no MSA, no quote)`);
  console.log('Visit /calendar — open each event: waived reads "MSA — Not required"; control reads "No active MSA" + Send MSA.');
}

async function cleanup() {
  console.log('Cleaning up 0100 fixtures…');
  const fixtureDealers = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(like(dealers.publicId, `${FIXTURE_MARKER}%`));
  const dealerIds = fixtureDealers.map((d) => d.id);
  if (dealerIds.length) {
    await db.delete(quotes).where(inArray(quotes.dealerId, dealerIds));
    await db.delete(campaigns).where(inArray(campaigns.dealerId, dealerIds));
    for (const id of dealerIds) await db.delete(dealers).where(eq(dealers.id, id));
  }
  console.log(`  removed ${dealerIds.length} fixture dealer(s) + their events/quotes.`);
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
