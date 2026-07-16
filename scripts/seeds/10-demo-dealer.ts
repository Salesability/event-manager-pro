// Demo dealer + booked campaign with the SMS add-on (0111 module 10) — the
// root entities every other demo module hangs off. The campaign is upcoming
// (next week) so the composer's default body reads like a real invitation,
// and booking settings are present so the /book surface works in a demo.

import { inArray, like } from 'drizzle-orm';
import {
  appointments,
  campaignBookingSettings,
  campaigns,
  dealers,
} from '../../src/lib/db/schema';
import { DEMO_PUBLIC_ID_PREFIX } from './markers';
import type { SeedDb, SeedModule } from './types';

export const DEMO_DEALER_PUBLIC_ID = `${DEMO_PUBLIC_ID_PREFIX}dealer`;
export const DEMO_CAMPAIGN_PUBLIC_ID = `${DEMO_PUBLIC_ID_PREFIX}sms-campaign`;

/** Shared lookup for downstream modules (20-sms-recipients, 30-sms-history). */
export async function findDemoCampaignId(db: SeedDb): Promise<number | null> {
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(like(campaigns.publicId, DEMO_CAMPAIGN_PUBLIC_ID))
    .limit(1);
  return campaign?.id ?? null;
}

function isoFromToday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export const demoDealerModule: SeedModule = {
  name: '10-demo-dealer',

  async seed(db) {
    const [dealer] = await db
      .insert(dealers)
      .values({
        publicId: DEMO_DEALER_PUBLIC_ID,
        name: 'Demo Motors',
        status: 'active',
      })
      .returning({ id: dealers.id });

    const [campaign] = await db
      .insert(campaigns)
      .values({
        publicId: DEMO_CAMPAIGN_PUBLIC_ID,
        dealerId: dealer.id,
        startDate: isoFromToday(7),
        endDate: isoFromToday(8),
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

    console.log(`   Demo Motors campaign id: ${campaign.id}`);
    console.log(`   SMS panel:  /calendar/${campaign.id}/sms`);
    console.log(`   Bookings:   /calendar/${campaign.id}/bookings`);
  },

  async clean(db) {
    // Scope: dealer + campaign + what hangs directly off the campaign
    // (recipients + booking settings cascade; appointments are `restrict` and
    // get created during live booking demos, so sweep them explicitly).
    // Send/thread history is module 30's scope — the runner cleans in reverse
    // order, so it's gone before this runs. An `--only 10-demo-dealer` clean
    // with history present fails loudly on the FK, which is the right signal.
    const campaignIds = (
      await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(like(campaigns.publicId, `${DEMO_PUBLIC_ID_PREFIX}%`))
    ).map((c) => c.id);
    if (campaignIds.length) {
      await db.delete(appointments).where(inArray(appointments.campaignId, campaignIds));
      await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
    }
    await db.delete(dealers).where(like(dealers.publicId, `${DEMO_PUBLIC_ID_PREFIX}%`));
  },
};
