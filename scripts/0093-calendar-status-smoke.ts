// 0093 chunk-end browser smoke fixture: seeds two booked events so the calendar
// commercial-status surface can be eyeballed in both states without wiring a
// real quote-accept / BoldSign-sign flow:
//   • a PROTECTED event  — dealer with an active MSA + an accepted quote tied
//     to the campaign → no "exposed" marker, "✓ Protected" banner.
//   • an EXPOSED event   — dealer with no MSA + no quote → amber ribbon dot,
//     "⚠ Commercially exposed" banner + Create-Quote / Send-MSA CTAs.
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0093-calendar-status-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0093-calendar-status-smoke.ts cleanup
//
// `cleanup` is idempotent (deletes by the FIXTURE_MARKER tag regardless of
// whether the rows exist), and respects FK order: quotes → campaigns → MSAs →
// dealers.

import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import {
  campaigns,
  dealers,
  masterServiceAgreements,
  quotes,
} from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local first)');
  process.exit(1);
}

const FIXTURE_MARKER = '0093-status-smoke';

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0093-calendar-status-smoke.ts <insert|cleanup>');
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

// Two dates this month-ish so they land on the visible grid.
function isoFromToday(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

async function insert() {
  console.log('Seeding 0093 calendar commercial-status fixtures…');

  // PROTECTED dealer: active MSA + an accepted quote on its event.
  const [protectedDealer] = await db
    .insert(dealers)
    .values({
      publicId: `${FIXTURE_MARKER}-protected`,
      name: `${FIXTURE_MARKER} Protected Motors`,
      status: 'active',
    })
    .returning({ id: dealers.id });

  const [exposedDealer] = await db
    .insert(dealers)
    .values({
      publicId: `${FIXTURE_MARKER}-exposed`,
      name: `${FIXTURE_MARKER} Exposed Auto`,
      status: 'active',
    })
    .returning({ id: dealers.id });

  const signedAt = new Date();
  const expiresAt = new Date(signedAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  await db.insert(masterServiceAgreements).values({
    dealerId: protectedDealer.id,
    status: 'active',
    signedAt,
    expiresAt,
    templateVersion: `${FIXTURE_MARKER}-v1`,
  });

  const [protectedCampaign] = await db
    .insert(campaigns)
    .values({
      publicId: `${FIXTURE_MARKER}-protected-evt`,
      dealerId: protectedDealer.id,
      status: 'booked',
      startDate: isoFromToday(3),
      endDate: isoFromToday(4),
    })
    .returning({ id: campaigns.id });

  await db.insert(quotes).values({
    dealerId: protectedDealer.id,
    campaignId: protectedCampaign.id,
    status: 'accepted',
    inputs: {},
  });

  const [exposedCampaign] = await db
    .insert(campaigns)
    .values({
      publicId: `${FIXTURE_MARKER}-exposed-evt`,
      dealerId: exposedDealer.id,
      status: 'booked',
      startDate: isoFromToday(5),
      endDate: isoFromToday(6),
    })
    .returning({ id: campaigns.id });

  console.log(`  protected event #${protectedCampaign.id} (active MSA + accepted quote)`);
  console.log(`  exposed event   #${exposedCampaign.id} (no MSA, no quote)`);
  console.log('Visit /calendar — the exposed event shows an amber dot; open each for the banner.');
}

async function cleanup() {
  console.log('Cleaning up 0093 fixtures…');
  const fixtureDealers = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(like(dealers.publicId, `${FIXTURE_MARKER}%`));
  const dealerIds = fixtureDealers.map((d) => d.id);
  if (dealerIds.length) {
    await db.delete(quotes).where(inArray(quotes.dealerId, dealerIds));
    await db.delete(campaigns).where(inArray(campaigns.dealerId, dealerIds));
    await db
      .delete(masterServiceAgreements)
      .where(inArray(masterServiceAgreements.dealerId, dealerIds));
    for (const id of dealerIds) await db.delete(dealers).where(eq(dealers.id, id));
  }
  console.log(`  removed ${dealerIds.length} fixture dealer(s) + their events/quotes/MSAs.`);
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
