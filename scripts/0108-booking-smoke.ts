// NOTE (0111): demo state now has a permanent home — `pnpm seed:demo`
// (scripts/seeds/). This script stays as the 0108 chunk-historical eval
// fixture; don't extend it for new demo needs.
//
// 0108 chunk-end browser smoke fixture: seeds a bookable campaign + one
// tokenized recipient so the public /book/<token> page and the staff bookings
// panel can be walked without importing a real dealer list:
//   • dealer "0108-booking-smoke Motors", booked campaign spanning today +
//     tomorrow, booking settings 9:00–17:00 / capacity 2;
//   • recipient "Sarah Smoketest" with the FIXED token below — the smoke
//     navigates straight to /book/<token>.
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0108-booking-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0108-booking-smoke.ts cleanup
//
// `cleanup` is idempotent and respects FK order: appointments (RESTRICT) →
// campaigns (settings + recipients cascade) → dealers.

import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import {
  appointments,
  campaignBookingSettings,
  campaigns,
  dealers,
  smsRecipients,
} from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local first)');
  process.exit(1);
}

const FIXTURE_MARKER = '0108-booking-smoke';
// Fixed (not unguessable) — sandbox-only smoke fixture the test navigates to.
const SMOKE_TOKEN = '0108-booking-smoke-token';

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0108-booking-smoke.ts <insert|cleanup>');
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

function isoFromToday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

async function insert() {
  console.log('Seeding 0108 booking smoke fixtures…');

  const [dealer] = await db
    .insert(dealers)
    .values({
      publicId: `${FIXTURE_MARKER}-dealer`,
      name: `${FIXTURE_MARKER} Motors`,
      status: 'active',
    })
    .returning({ id: dealers.id });

  const [campaign] = await db
    .insert(campaigns)
    .values({
      publicId: `${FIXTURE_MARKER}-campaign`,
      dealerId: dealer.id,
      // Single-day: duplicate time labels across days trip the browse tool's
      // strict-mode role+name click resolution.
      startDate: isoFromToday(0),
      endDate: isoFromToday(0),
      status: 'booked',
      smsEmail: 100,
    })
    .returning({ id: campaigns.id });

  await db.insert(campaignBookingSettings).values({
    campaignId: campaign.id,
    dayStartMinute: 540,
    dayEndMinute: 1020,
    slotCapacity: 2,
  });

  await db.insert(smsRecipients).values({
    campaignId: campaign.id,
    phone: '+19995590001',
    firstName: 'Sarah',
    lastName: 'Smoketest',
    consentBasis: 'express',
    bookingToken: SMOKE_TOKEN,
  });

  console.log(`Campaign id: ${campaign.id}`);
  console.log(`Public page: /book/${SMOKE_TOKEN}`);
  console.log(`Staff page:  /calendar/${campaign.id}/bookings`);
}

async function cleanup() {
  console.log('Cleaning 0108 booking smoke fixtures…');
  const campaignIds = (
    await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(like(campaigns.publicId, `${FIXTURE_MARKER}%`))
  ).map((c) => c.id);
  if (campaignIds.length) {
    await db.delete(appointments).where(inArray(appointments.campaignId, campaignIds));
    await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  }
  await db.delete(dealers).where(like(dealers.publicId, `${FIXTURE_MARKER}%`));
  console.log(`Removed ${campaignIds.length} campaign(s) + fixture dealer.`);
}

(arg === 'insert' ? insert() : cleanup())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end({ timeout: 5 }));
