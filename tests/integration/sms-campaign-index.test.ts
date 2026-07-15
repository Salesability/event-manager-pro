import { randomBytes } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres checks for the 0109 /sms campaign index:
//   • qualification = gate-active (booked + smsEmail > 0) ∪ has-history
//     (sends or threads) — a draft with nothing is excluded, a completed
//     campaign with a send stays listed after the gate lapses;
//   • per-row aggregates (recipients, sends + last-send-at, threads, unread)
//     count only the row's own campaign.
// The sandbox DB is shared, so assertions filter to this file's fixture
// campaigns and never assert on the global list shape.
//
// `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

// MUST precede every `@/…` import: the queries module's chain evaluates the
// app db pool, which reads DATABASE_URL at import time.
import './helpers/load-env';

import * as schema from '@/lib/db/schema';
import {
  campaigns,
  dealers,
  smsRecipients,
  smsSends,
  smsThreads,
} from '@/lib/db/schema';
import { loadSmsCampaignIndex } from '@/features/sms/queries';

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');

// Distinct from the other sms integration files (+1999555/6/7/8) so the
// files' sweeps never touch each other's rows on the shared DB.
const PHONE_PREFIX = '+1999560';

type TestDb = PostgresJsDatabase<typeof schema>;

describe.skipIf(!dbUrl)('sms campaign index (0109)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  const fixtures = { dealerIds: [] as number[], campaignIds: [] as number[] };

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  afterEach(async () => {
    if (fixtures.campaignIds.length) {
      // sends + threads RESTRICT campaigns; recipients cascade.
      await db.delete(smsThreads).where(inArray(smsThreads.campaignId, fixtures.campaignIds));
      await db.delete(smsSends).where(inArray(smsSends.campaignId, fixtures.campaignIds));
      await db.delete(campaigns).where(inArray(campaigns.id, fixtures.campaignIds));
    }
    if (fixtures.dealerIds.length) {
      await db.delete(dealers).where(inArray(dealers.id, fixtures.dealerIds));
    }
    fixtures.dealerIds = [];
    fixtures.campaignIds = [];
  });

  async function seedCampaign(
    dealerName: string,
    over: Partial<typeof campaigns.$inferInsert> = {},
  ) {
    const [dealer] = await db
      .insert(dealers)
      .values({ publicId: publicId(), name: dealerName })
      .returning({ id: dealers.id });
    fixtures.dealerIds.push(dealer.id);
    const [campaign] = await db
      .insert(campaigns)
      .values({
        publicId: publicId(),
        dealerId: dealer.id,
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        status: 'booked',
        smsEmail: 100,
        ...over,
      })
      .returning({ id: campaigns.id });
    fixtures.campaignIds.push(campaign.id);
    return campaign.id;
  }

  it('lists gate-active ∪ has-history and excludes everything else', async () => {
    const gateActive = await seedCampaign('Index Gate-Active Motors');
    const draftNothing = await seedCampaign('Index Draft Motors', {
      status: 'draft',
      smsEmail: null,
    });
    const lapsedWithSend = await seedCampaign('Index Lapsed Motors', {
      status: 'completed',
      smsEmail: 50,
    });
    await db.insert(smsSends).values({
      campaignId: lapsedWithSend,
      body: 'past launch',
      totalRecipients: 3,
      excludedOptOut: 0,
      excludedStaleConsent: 0,
    });
    const cancelledWithThread = await seedCampaign('Index Cancelled Motors', {
      status: 'cancelled',
      smsEmail: null,
    });
    await db.insert(smsThreads).values({
      campaignId: cancelledWithThread,
      phone: `${PHONE_PREFIX}0001`,
    });

    const index = await loadSmsCampaignIndex();
    const mine = new Map(
      index
        .filter((r) => fixtures.campaignIds.includes(r.campaignId))
        .map((r) => [r.campaignId, r]),
    );

    expect(mine.has(gateActive)).toBe(true);
    expect(mine.get(gateActive)).toMatchObject({ gateActive: true, sendCount: 0 });

    expect(mine.has(draftNothing)).toBe(false);

    expect(mine.get(lapsedWithSend)).toMatchObject({
      gateActive: false,
      status: 'completed',
      sendCount: 1,
    });
    expect(mine.get(lapsedWithSend)!.lastSendAt).toBeInstanceOf(Date);

    expect(mine.get(cancelledWithThread)).toMatchObject({
      gateActive: false,
      status: 'cancelled',
      threadCount: 1,
    });
  });

  it('aggregates recipients, sends, threads, and unread per campaign', async () => {
    const busy = await seedCampaign('Index Busy Motors');
    const quiet = await seedCampaign('Index Quiet Motors');

    await db.insert(smsRecipients).values([
      {
        campaignId: busy,
        phone: `${PHONE_PREFIX}0002`,
        consentBasis: 'express',
      },
      {
        campaignId: busy,
        phone: `${PHONE_PREFIX}0003`,
        consentBasis: 'express',
      },
    ]);
    await db.insert(smsSends).values([
      {
        campaignId: busy,
        body: 'first',
        totalRecipients: 2,
        excludedOptOut: 0,
        excludedStaleConsent: 0,
        createdAt: new Date('2026-07-01T12:00:00Z'),
      },
      {
        campaignId: busy,
        body: 'second',
        totalRecipients: 2,
        excludedOptOut: 0,
        excludedStaleConsent: 0,
        createdAt: new Date('2026-07-10T12:00:00Z'),
      },
    ]);
    await db.insert(smsThreads).values([
      {
        // Unread: inbound newer than the read pointer.
        campaignId: busy,
        phone: `${PHONE_PREFIX}0002`,
        lastInboundAt: new Date('2026-07-11T12:00:00Z'),
        lastReadAt: null,
      },
      {
        // Read thread: counted in threadCount, not unread.
        campaignId: busy,
        phone: `${PHONE_PREFIX}0003`,
        lastInboundAt: new Date('2026-07-11T12:00:00Z'),
        lastReadAt: new Date('2026-07-11T13:00:00Z'),
      },
    ]);

    const index = await loadSmsCampaignIndex();
    const busyRow = index.find((r) => r.campaignId === busy)!;
    expect(busyRow).toMatchObject({
      gateActive: true,
      recipientCount: 2,
      sendCount: 2,
      threadCount: 2,
      unreadThreads: 1,
    });
    expect(busyRow.lastSendAt).toEqual(new Date('2026-07-10T12:00:00Z'));

    // The quiet sibling's aggregates stay untouched by the busy one's rows.
    expect(index.find((r) => r.campaignId === quiet)).toMatchObject({
      recipientCount: 0,
      sendCount: 0,
      threadCount: 0,
      unreadThreads: 0,
      lastSendAt: null,
    });
  });
});
