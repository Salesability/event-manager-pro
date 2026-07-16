// 0113 chunk-end browser smoke fixture: seeds TWO gate-active campaigns so
// both sides of the one-broadcast guard render in one insert:
//   • "fresh" — a recipient imported, nothing sent → the composer (Compose
//     section + "Launch send" button) must render;
//   • "broadcast" — one launch with a `provider_sid`-stamped message → the
//     already-sent notice must replace the composer (no "Launch send").
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0113-broadcast-guard-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0113-broadcast-guard-smoke.ts cleanup
//
// `cleanup` is idempotent and respects FK order: ledger messages → sends →
// recipients → campaigns → dealers (marker-swept, cf. 0110-console-polish-smoke).

import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import {
  campaigns,
  dealers,
  smsMessages,
  smsRecipients,
  smsSends,
} from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local first)');
  process.exit(1);
}

const FIXTURE_MARKER = '0113-broadcast-smoke';
const PHONE_PREFIX = '+1999560';
const FRESH_RECIPIENT = `${PHONE_PREFIX}0001`;
const SENT_RECIPIENT = `${PHONE_PREFIX}0002`;

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0113-broadcast-guard-smoke.ts <insert|cleanup>');
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
  console.log('Seeding 0113 broadcast-guard smoke fixtures…');

  const [dealer] = await db
    .insert(dealers)
    .values({
      publicId: `${FIXTURE_MARKER}-dealer`,
      name: `${FIXTURE_MARKER} Motors`,
      status: 'active',
    })
    .returning({ id: dealers.id });

  const [fresh] = await db
    .insert(campaigns)
    .values({
      publicId: `${FIXTURE_MARKER}-fresh`,
      dealerId: dealer.id,
      startDate: isoFromToday(0),
      endDate: isoFromToday(0),
      status: 'booked',
      smsEmail: 100,
    })
    .returning({ id: campaigns.id });
  await db.insert(smsRecipients).values({
    campaignId: fresh.id,
    phone: FRESH_RECIPIENT,
    firstName: 'Fresh',
    lastName: 'Fixture',
    consentBasis: 'express',
  });

  const [broadcast] = await db
    .insert(campaigns)
    .values({
      publicId: `${FIXTURE_MARKER}-broadcast`,
      dealerId: dealer.id,
      startDate: isoFromToday(0),
      endDate: isoFromToday(0),
      status: 'booked',
      smsEmail: 100,
    })
    .returning({ id: campaigns.id });
  await db.insert(smsRecipients).values({
    campaignId: broadcast.id,
    phone: SENT_RECIPIENT,
    firstName: 'Already',
    lastName: 'Sent',
    consentBasis: 'express',
  });
  const [send] = await db
    .insert(smsSends)
    .values({
      campaignId: broadcast.id,
      body: 'Hi {{first_name}}, fixture broadcast body. Reply STOP to opt out.',
      totalRecipients: 1,
      excludedOptOut: 0,
      excludedStaleConsent: 0,
    })
    .returning({ id: smsSends.id });
  await db.insert(smsMessages).values({
    sendId: send.id,
    phone: SENT_RECIPIENT,
    providerSid: `${FIXTURE_MARKER}-m1`,
    status: 'delivered',
  });

  console.log(`Fresh (composer expected): /calendar/${fresh.id}/sms`);
  console.log(`Broadcast (already-sent notice expected): /calendar/${broadcast.id}/sms`);
}

async function cleanup() {
  console.log('Cleaning 0113 broadcast-guard smoke fixtures…');
  const campaignIds = (
    await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(like(campaigns.publicId, `${FIXTURE_MARKER}%`))
  ).map((c) => c.id);
  if (campaignIds.length) {
    await db.delete(smsMessages).where(like(smsMessages.phone, `${PHONE_PREFIX}%`));
    await db.delete(smsSends).where(inArray(smsSends.campaignId, campaignIds));
    await db
      .delete(smsRecipients)
      .where(inArray(smsRecipients.campaignId, campaignIds));
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
