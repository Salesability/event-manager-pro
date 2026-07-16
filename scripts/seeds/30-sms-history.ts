// Fabricated send + conversation history for the demo campaign (0111 module
// 30). No Twilio call ever made these rows — they're clearly marked (every
// providerSid starts `demo-`) and exist so the funnel strip, send log,
// conversation console, inbox, and /sms aggregates all light up without a
// phone in the loop (intent's fabricate-clearly-marked leaning).
//
// Narrative: one launch went out to every recipient sendable at the time
// (Morgan Grant was already stale; Pat Quinn had not yet replied STOP) —
// including the module-25 reply testers, whose fabricated ledger rows are
// what lets a staff reply attribute to the demo campaign with NO live launch.
// Alex Morgan replied and reads positive/hot; Pat Quinn replied STOP (module
// 20 owns the registry row).
//
// Printed-numbers contract (reconciles with `loadSmsCampaignFunnel`):
//   funnel:   7 sent / 6 delivered / 1 response / 6 no response / 1 stop
//   send row: 8 on list, 0 opted out at launch, 1 stale consent
//   pre-send NOW (modules 20+25): 8 imported / 6 eligible / 1 opted out / 1 stale

import { eq, inArray } from 'drizzle-orm';
import {
  smsMessages,
  smsRecipients,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '../../src/lib/db/schema';
import { findDemoCampaignId } from './10-demo-dealer';
import { DEMO_RECIPIENTS, DEMO_STOPPED_PHONE } from './20-sms-recipients';
import type { SeedDb, SeedModule } from './types';

const RESPONDER = DEMO_RECIPIENTS[0]; // Alex Morgan
const STALE_PHONE = DEMO_RECIPIENTS[4].phone; // Morgan Grant — excluded from the send

const SEND_BODY =
  'Hi {{first_name}}, {{dealer_name}} is hosting a private sales event next week. Reply to book your appointment.\nReply STOP to opt out.';

async function findDemoSendIds(db: SeedDb, campaignIds: number[]): Promise<number[]> {
  if (!campaignIds.length) return [];
  const rows = await db
    .select({ id: smsSends.id })
    .from(smsSends)
    .where(inArray(smsSends.campaignId, campaignIds));
  return rows.map((r) => r.id);
}

export const smsHistoryModule: SeedModule = {
  name: '30-sms-history',

  async seed(db) {
    const campaignId = await findDemoCampaignId(db);
    if (campaignId == null) {
      throw new Error('Demo campaign not found — run the full `pnpm seed:demo` (module 10 first).');
    }
    const recipients = await db
      .select({
        id: smsRecipients.id,
        phone: smsRecipients.phone,
        firstName: smsRecipients.firstName,
        lastName: smsRecipients.lastName,
        consentBasis: smsRecipients.consentBasis,
        lastContactAt: smsRecipients.lastContactAt,
        identityHmac: smsRecipients.identityHmac,
      })
      .from(smsRecipients)
      .where(eq(smsRecipients.campaignId, campaignId));
    if (!recipients.length) {
      throw new Error('Demo recipients not found — run the full `pnpm seed:demo` (module 20 first).');
    }

    const [send] = await db
      .insert(smsSends)
      .values({
        campaignId,
        body: SEND_BODY,
        totalRecipients: recipients.length,
        excludedOptOut: 0, // Pat's STOP came AFTER this launch
        excludedStaleConsent: 1, // Morgan Grant
      })
      .returning({ id: smsSends.id });

    const messaged = recipients.filter((r) => r.phone !== STALE_PHONE);
    await db.insert(smsMessages).values(
      messaged.map((r, i) => ({
        sendId: send.id,
        recipientId: r.id,
        phone: r.phone,
        providerSid: `demo-m${i + 1}`,
        // Sam Patel stays `sent` (no delivery receipt yet) so the send log
        // shows a mixed-status launch; everyone else delivered.
        status: (r.phone === DEMO_RECIPIENTS[2].phone ? 'sent' : 'delivered') as
          | 'sent'
          | 'delivered',
        consentBasis: r.consentBasis,
        lastContactAt: r.lastContactAt,
        identityHmac: r.identityHmac,
      })),
    );

    // Alex's conversation, as the 0106/0110 writers would leave it: name
    // snapshot stamped, inbound last (turn-state: awaiting your reply),
    // classifier labels pre-stamped so the demo needs no ANTHROPIC_API_KEY.
    const now = new Date();
    const [thread] = await db
      .insert(smsThreads)
      .values({
        campaignId,
        phone: RESPONDER.phone,
        displayName: `${RESPONDER.firstName} ${RESPONDER.lastName}`,
        sentiment: 'positive',
        prospectTemperature: 'hot',
        classifiedAt: now,
        lastMessageAt: now,
        lastInboundAt: now,
      })
      .returning({ id: smsThreads.id });
    await db.insert(smsThreadMessages).values({
      threadId: thread.id,
      direction: 'outbound',
      body: `Hi ${RESPONDER.firstName}, Demo Motors is hosting a private sales event next week. Reply to book your appointment.\nReply STOP to opt out.`,
      providerSid: 'demo-out-1',
      status: 'delivered',
    });
    await db.insert(smsThreadMessages).values({
      threadId: thread.id,
      direction: 'inbound',
      body: 'Sounds great — can I book Saturday morning?',
      providerSid: 'demo-in-1',
    });

    console.log(
      `   History: 1 send, ${messaged.length} messages, 1 conversation (Alex Morgan, positive/hot)`,
    );
    console.log('   Expected funnel: 7 sent / 6 delivered / 1 response / 6 no response / 1 stop');
    console.log(`   Stop registry: ${DEMO_STOPPED_PHONE} (replied STOP after this launch)`);
  },

  async clean(db) {
    // Scope: everything hanging off demo sends/threads. Resolved via the demo
    // campaign (marker-owned publicId) so no real campaign's ledger is ever in
    // range; FK order: thread messages → threads → messages → sends.
    const campaignId = await findDemoCampaignId(db);
    const campaignIds = campaignId == null ? [] : [campaignId];
    const threadIds = campaignIds.length
      ? (
          await db
            .select({ id: smsThreads.id })
            .from(smsThreads)
            .where(inArray(smsThreads.campaignId, campaignIds))
        ).map((t) => t.id)
      : [];
    if (threadIds.length) {
      await db.delete(smsThreadMessages).where(inArray(smsThreadMessages.threadId, threadIds));
      await db.delete(smsThreads).where(inArray(smsThreads.id, threadIds));
    }
    const sendIds = await findDemoSendIds(db, campaignIds);
    if (sendIds.length) {
      await db.delete(smsMessages).where(inArray(smsMessages.sendId, sendIds));
      await db.delete(smsSends).where(inArray(smsSends.id, sendIds));
    }
  },
};
