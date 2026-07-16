// Real staff numbers on the demo campaign (0111 follow-up) so live reply
// testing works out of the box: inbound attribution matches the SENDER's
// number against listed recipient phones, and module 30 fabricates ledger
// rows for these testers too — so a staff text TO the stage number threads
// immediately after `pnpm seed:demo`, no live launch required. Stage outbound
// is dev-redirected to SMS_DEV_TO, so these rows never cause a text to a
// second phone.
//
// With this module the pre-send review reads 8 imported / 6 eligible /
// 1 opted out / 1 stale, and the funnel contract becomes 7 sent / 6
// delivered / 1 response / 6 no response / 1 stop (module 30's print).
//
// Clean scope: exact phones, demo campaign only — a real campaign that ever
// lists one of these numbers is out of reach by construction. If a tester
// texts STOP during a session, the resulting opt-out row for their REAL
// number is deliberately NOT swept here — delete it by hand when intended.

import { and, eq, inArray } from 'drizzle-orm';
import { computeIdentityHmac } from '../../src/lib/sms/identity';
import { smsRecipients } from '../../src/lib/db/schema';
import { findDemoCampaignId } from './10-demo-dealer';
import type { SeedModule } from './types';

export const REPLY_TESTERS = [
  { phone: '+15149185000', firstName: 'David', lastName: 'Hogan' },
  { phone: '+19028026215', firstName: 'Shannon', lastName: 'Tilley' },
];

const TESTER_PHONES = REPLY_TESTERS.map((t) => t.phone);

export const replyTestersModule: SeedModule = {
  name: '25-reply-testers',

  async seed(db) {
    const campaignId = await findDemoCampaignId(db);
    if (campaignId == null) {
      throw new Error('Demo campaign not found — run the full `pnpm seed:demo` (module 10 first).');
    }
    await db.insert(smsRecipients).values(
      REPLY_TESTERS.map((t) => ({
        campaignId,
        phone: t.phone,
        firstName: t.firstName,
        lastName: t.lastName,
        consentBasis: 'express' as const,
        identityHmac: computeIdentityHmac(t),
      })),
    );
    console.log(
      `   Reply testers: ${REPLY_TESTERS.map((t) => `${t.firstName} ${t.phone}`).join(', ')}`,
    );
    console.log('   Pre-send now reads: 8 imported / 6 eligible / 1 opted out / 1 stale');
  },

  async clean(db) {
    const campaignId = await findDemoCampaignId(db);
    if (campaignId == null) return;
    await db
      .delete(smsRecipients)
      .where(
        and(
          eq(smsRecipients.campaignId, campaignId),
          inArray(smsRecipients.phone, TESTER_PHONES),
        ),
      );
  },
};
