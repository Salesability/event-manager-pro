// 0110 chunk-end browser smoke fixture: seeds one gate-active campaign whose
// SMS surfaces exercise every polish item at once:
//   • recipient "Sarah Smoketest" + a conversation thread carrying her name
//     snapshot, an inbound last message (turn-state: awaiting your reply),
//     and pre-stamped classifier labels (sentiment positive / hot prospect);
//   • a launch send with 3 ledger messages (2 delivered, 1 sent) + one
//     opted-out messaged number → funnel strip reads
//     3 sent / 2 delivered / 1 response / 2 no response / 1 stop.
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0110-console-polish-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0110-console-polish-smoke.ts cleanup
//
// `cleanup` is idempotent and respects FK order: thread messages → threads →
// ledger messages → sends → recipients (cascade) → campaigns → dealers →
// opt-outs (prefix-swept).

import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local first)');
  process.exit(1);
}

const FIXTURE_MARKER = '0110-polish-smoke';
const PHONE_PREFIX = '+1999558';
const RESPONDER = `${PHONE_PREFIX}0001`;
const SILENT = `${PHONE_PREFIX}0002`;
const STOPPER = `${PHONE_PREFIX}0003`;

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0110-console-polish-smoke.ts <insert|cleanup>');
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
  console.log('Seeding 0110 console-polish smoke fixtures…');

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
      startDate: isoFromToday(0),
      endDate: isoFromToday(0),
      status: 'booked',
      smsEmail: 100,
    })
    .returning({ id: campaigns.id });

  await db.insert(smsRecipients).values({
    campaignId: campaign.id,
    phone: RESPONDER,
    firstName: 'Sarah',
    lastName: 'Smoketest',
    consentBasis: 'express',
  });

  const [send] = await db
    .insert(smsSends)
    .values({
      campaignId: campaign.id,
      body: 'Hi {{first_name}}, fixture launch body. Reply STOP to opt out.',
      totalRecipients: 3,
      excludedOptOut: 0,
      excludedStaleConsent: 0,
    })
    .returning({ id: smsSends.id });
  await db.insert(smsMessages).values([
    { sendId: send.id, phone: RESPONDER, providerSid: `${FIXTURE_MARKER}-m1`, status: 'delivered' },
    { sendId: send.id, phone: SILENT, providerSid: `${FIXTURE_MARKER}-m2`, status: 'sent' },
    { sendId: send.id, phone: STOPPER, providerSid: `${FIXTURE_MARKER}-m3`, status: 'delivered' },
  ]);

  // Thread as the 0110 writers would leave it after Sarah's inbound: name
  // snapshot stamped, inbound last (awaiting your reply), classifier labels
  // pre-stamped so the smoke needs no ANTHROPIC_API_KEY.
  const now = new Date();
  const [thread] = await db
    .insert(smsThreads)
    .values({
      campaignId: campaign.id,
      phone: RESPONDER,
      displayName: 'Sarah Smoketest',
      sentiment: 'positive',
      prospectTemperature: 'hot',
      classifiedAt: now,
      lastMessageAt: now,
      lastInboundAt: now,
    })
    .returning({ id: smsThreads.id });
  await db.insert(smsThreadMessages).values({
    threadId: thread.id,
    direction: 'inbound',
    body: 'Very interested! Can I book Saturday morning?',
    providerSid: `${FIXTURE_MARKER}-in1`,
  });

  await db
    .insert(smsOptOuts)
    .values({ phone: STOPPER, source: 'manual' })
    .onConflictDoNothing({ target: smsOptOuts.phone });

  console.log(`Campaign id: ${campaign.id}`);
  console.log(`Campaign SMS page: /calendar/${campaign.id}/sms`);
  console.log('Inbox: /messages · Index: /sms');
  console.log('Expected funnel: 3 sent / 2 delivered / 1 response / 2 no response / 1 stop');
}

async function cleanup() {
  console.log('Cleaning 0110 console-polish smoke fixtures…');
  const campaignIds = (
    await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(like(campaigns.publicId, `${FIXTURE_MARKER}%`))
  ).map((c) => c.id);
  if (campaignIds.length) {
    const threadIds = (
      await db
        .select({ id: smsThreads.id })
        .from(smsThreads)
        .where(inArray(smsThreads.campaignId, campaignIds))
    ).map((t) => t.id);
    if (threadIds.length) {
      await db
        .delete(smsThreadMessages)
        .where(inArray(smsThreadMessages.threadId, threadIds));
      await db.delete(smsThreads).where(inArray(smsThreads.id, threadIds));
    }
    await db.delete(smsMessages).where(like(smsMessages.phone, `${PHONE_PREFIX}%`));
    await db.delete(smsSends).where(inArray(smsSends.campaignId, campaignIds));
    await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  }
  await db.delete(dealers).where(like(dealers.publicId, `${FIXTURE_MARKER}%`));
  await db.delete(smsOptOuts).where(like(smsOptOuts.phone, `${PHONE_PREFIX}%`));
  console.log(`Removed ${campaignIds.length} campaign(s) + fixture dealer + opt-outs.`);
}

(arg === 'insert' ? insert() : cleanup())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end({ timeout: 5 }));
