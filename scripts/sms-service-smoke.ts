// 0103 Phase 6 browser-smoke fixture: seeds one BOOKED campaign with the SMS
// add-on active (smsEmail > 0) + a small recipient list exercising every
// pre-send review state (eligible / opted-out / stale-consent) + one prior
// send with a delivered + failed message pair, so `/calendar/<id>/sms` renders
// the full panel (review badges, excluded list with reasons, send log) for a
// read-only eyeball — no real Twilio call is made.
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/sms-service-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/sms-service-smoke.ts cleanup
//
// `insert` prints the seeded campaign id (the smoke navigates to
// /calendar/<id>/sms). `cleanup` is idempotent — deletes by the FIXTURE_MARKER
// dealer name + the fixture phone prefix, respecting FK order:
// messages → sends → recipients → opt-outs → campaigns → dealers.

import { eq, inArray, like } from 'drizzle-orm';
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
} from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local first)');
  process.exit(1);
}

const FIXTURE_MARKER = '[0103-smoke] SMS Panel Dealer';
const PHONE_PREFIX = '+1999777';

async function main() {
  const mode = process.argv[2];
  if (mode !== 'insert' && mode !== 'cleanup') {
    console.error('Usage: sms-service-smoke.ts <insert|cleanup>');
    process.exit(1);
  }

  const client = postgres(DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(client, { schema });

  try {
    if (mode === 'cleanup') {
      const dealerRows = await db
        .select({ id: dealers.id })
        .from(dealers)
        .where(eq(dealers.name, FIXTURE_MARKER));
      const dealerIds = dealerRows.map((d) => d.id);
      if (dealerIds.length) {
        const campaignRows = await db
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(inArray(campaigns.dealerId, dealerIds));
        const campaignIds = campaignRows.map((c) => c.id);
        if (campaignIds.length) {
          const sendRows = await db
            .select({ id: smsSends.id })
            .from(smsSends)
            .where(inArray(smsSends.campaignId, campaignIds));
          const sendIds = sendRows.map((s) => s.id);
          if (sendIds.length) {
            await db.delete(smsMessages).where(inArray(smsMessages.sendId, sendIds));
            await db.delete(smsSends).where(inArray(smsSends.id, sendIds));
          }
          await db
            .delete(smsRecipients)
            .where(inArray(smsRecipients.campaignId, campaignIds));
          await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
        }
        await db.delete(dealers).where(inArray(dealers.id, dealerIds));
      }
      await db.delete(smsOptOuts).where(like(smsOptOuts.phone, `${PHONE_PREFIX}%`));
      console.log('Cleaned up 0103 smoke fixtures.');
      return;
    }

    const [dealer] = await db
      .insert(dealers)
      .values({ publicId: `0103smoke-${Date.now()}`, name: FIXTURE_MARKER })
      .returning({ id: dealers.id });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        publicId: `0103smoke-c-${Date.now()}`,
        dealerId: dealer.id,
        startDate: '2026-08-15',
        endDate: '2026-08-16',
        status: 'booked',
        smsEmail: 250,
        qtyRecords: 500,
      })
      .returning({ id: campaigns.id });

    await db.insert(smsRecipients).values([
      {
        campaignId: campaign.id,
        phone: `${PHONE_PREFIX}0001`,
        firstName: 'Evie',
        consentBasis: 'express',
        // Matches the prior send's fingerprint below → "same person as before".
        identityHmac: 'evie'.padEnd(64, '0'),
      },
      {
        campaignId: campaign.id,
        phone: `${PHONE_PREFIX}0002`,
        firstName: 'Piers',
        consentBasis: 'implied_purchase',
        lastContactAt: '2026-02-01',
        // Differs from the prior send's fingerprint → recycled-number warning.
        identityHmac: 'piers-new'.padEnd(64, '0'),
      },
      {
        campaignId: campaign.id,
        phone: `${PHONE_PREFIX}0003`,
        firstName: 'Stan',
        consentBasis: 'implied_inquiry',
        lastContactAt: '2024-01-01',
      },
      {
        campaignId: campaign.id,
        phone: `${PHONE_PREFIX}0004`,
        firstName: 'Olive',
        consentBasis: 'express',
      },
    ]);
    await db
      .insert(smsOptOuts)
      .values({ phone: `${PHONE_PREFIX}0004`, source: 'stop_reply' })
      .onConflictDoNothing({ target: smsOptOuts.phone });

    const [send] = await db
      .insert(smsSends)
      .values({
        campaignId: campaign.id,
        body: 'Hi {{first_name}}, {{dealer_name}} is hosting a private event Aug 15–16. Reply STOP to opt out.',
        totalRecipients: 4,
        excludedOptOut: 1,
        excludedStaleConsent: 1,
      })
      .returning({ id: smsSends.id });
    await db.insert(smsMessages).values([
      {
        sendId: send.id,
        phone: `${PHONE_PREFIX}0001`,
        providerSid: 'SM0103smoke0001',
        status: 'delivered',
        statusUpdatedAt: new Date(),
        consentBasis: 'express',
        identityHmac: 'evie'.padEnd(64, '0'),
      },
      {
        sendId: send.id,
        phone: `${PHONE_PREFIX}0002`,
        providerSid: 'SM0103smoke0002',
        status: 'failed',
        errorCode: '30007',
        statusUpdatedAt: new Date(),
        consentBasis: 'implied_purchase',
        lastContactAt: '2025-06-01',
        identityHmac: 'piers-old'.padEnd(64, '0'),
      },
    ]);

    console.log(`Inserted 0103 smoke fixture. campaignId=${campaign.id}`);
    console.log(`Navigate to /calendar/${campaign.id}/sms`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
