// Consent-mix recipient list for the demo campaign (0111 module 20) — the
// 2026-07-15 Century Mazda one-off made permanent, moved onto the demo dealer.
// Every recipient exists to light up a specific pre-send chip:
//
//   Alex Morgan   +19995550101  express            eligible — the responder (module 30 threads her)
//   Jordan Lee    +19995550102  implied_purchase   eligible (3 months ago, inside 24)
//   Sam Patel     +19995550103  implied_inquiry    eligible (2 months ago, inside 6)
//   Riley Chen    +19995550104  express            eligible
//   Morgan Grant  +19995550105  implied_purchase   STALE (25 months ago — CASL window closed)
//   Pat Quinn     +19995550106  express            OPTED OUT (replied STOP — registry row below)
//
// Pre-send review contract: 6 imported / 4 eligible / 1 opted out / 1 stale.
//
// `computeIdentityHmac` imports `server-only`, so the seed:demo script runs
// tsx with NODE_OPTIONS=--conditions=react-server (key unset → null
// fingerprints, and the import/launch surfaces degrade gracefully).

import { like } from 'drizzle-orm';
import { computeIdentityHmac } from '../../src/lib/sms/identity';
import { smsOptOuts, smsRecipients } from '../../src/lib/db/schema';
import { findDemoCampaignId } from './10-demo-dealer';
import { DEMO_PHONE_PREFIX } from './markers';
import type { SeedModule } from './types';

export const DEMO_BOOKING_TOKEN = 'demo-booking-token';

export type DemoRecipient = {
  phone: string;
  firstName: string;
  lastName: string;
  consentBasis: 'express' | 'implied_purchase' | 'implied_inquiry';
  /** Months back for last_contact_at; null = no contact date recorded. */
  lastContactMonthsAgo: number | null;
};

export const DEMO_RECIPIENTS: DemoRecipient[] = [
  { phone: `${DEMO_PHONE_PREFIX}0101`, firstName: 'Alex', lastName: 'Morgan', consentBasis: 'express', lastContactMonthsAgo: 1 },
  { phone: `${DEMO_PHONE_PREFIX}0102`, firstName: 'Jordan', lastName: 'Lee', consentBasis: 'implied_purchase', lastContactMonthsAgo: 3 },
  { phone: `${DEMO_PHONE_PREFIX}0103`, firstName: 'Sam', lastName: 'Patel', consentBasis: 'implied_inquiry', lastContactMonthsAgo: 2 },
  { phone: `${DEMO_PHONE_PREFIX}0104`, firstName: 'Riley', lastName: 'Chen', consentBasis: 'express', lastContactMonthsAgo: null },
  { phone: `${DEMO_PHONE_PREFIX}0105`, firstName: 'Morgan', lastName: 'Grant', consentBasis: 'implied_purchase', lastContactMonthsAgo: 25 },
  { phone: `${DEMO_PHONE_PREFIX}0106`, firstName: 'Pat', lastName: 'Quinn', consentBasis: 'express', lastContactMonthsAgo: 2 },
];

/** The STOP-replier — messaged by module 30's send, opted out afterwards. */
export const DEMO_STOPPED_PHONE = `${DEMO_PHONE_PREFIX}0106`;

export function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export const smsRecipientsModule: SeedModule = {
  name: '20-sms-recipients',

  async seed(db) {
    const campaignId = await findDemoCampaignId(db);
    if (campaignId == null) {
      throw new Error('Demo campaign not found — run the full `pnpm seed:demo` (module 10 first).');
    }

    await db.insert(smsRecipients).values(
      DEMO_RECIPIENTS.map((r) => ({
        campaignId,
        phone: r.phone,
        firstName: r.firstName,
        lastName: r.lastName,
        consentBasis: r.consentBasis,
        lastContactAt: r.lastContactMonthsAgo == null ? null : isoMonthsAgo(r.lastContactMonthsAgo),
        identityHmac: computeIdentityHmac({
          firstName: r.firstName,
          lastName: r.lastName,
          phone: r.phone,
        }),
        // The responder's fixed token makes /book/<token> demoable without a
        // real send stamping one (0108 flow). Fixed, not unguessable — demo
        // data on the sandbox only, same posture as the 0108 smoke token.
        bookingToken: r.phone === DEMO_RECIPIENTS[0].phone ? DEMO_BOOKING_TOKEN : null,
      })),
    );

    await db
      .insert(smsOptOuts)
      .values({
        phone: DEMO_STOPPED_PHONE,
        source: 'stop_reply',
        providerMessageSid: 'demo-stop-1',
      })
      .onConflictDoNothing({ target: smsOptOuts.phone });

    console.log('   Recipients: 6 imported / 4 eligible / 1 opted out / 1 stale consent');
    console.log(`   Booking page: /book/${DEMO_BOOKING_TOKEN}`);
  },

  async clean(db) {
    // Scope: the reserved demo phone block — recipients on any demo campaign
    // plus the STOP registry row. Never touches real numbers by construction.
    await db.delete(smsRecipients).where(like(smsRecipients.phone, `${DEMO_PHONE_PREFIX}%`));
    await db.delete(smsOptOuts).where(like(smsOptOuts.phone, `${DEMO_PHONE_PREFIX}%`));
  },
};
