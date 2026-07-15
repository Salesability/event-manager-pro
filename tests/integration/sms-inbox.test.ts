import { randomBytes } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres checks for the 0107 global inbox read model:
//   • loadSmsInbox aggregates threads across campaigns, joins dealer/event
//     context onto each row, derives unread + opted-out, and sorts
//     needs-action-first (unread above read regardless of recency);
//   • loadInboxUnreadCount tracks the inbound → read → new-inbound lifecycle.
// The sandbox DB is shared, so every assertion filters to this file's
// fixtures (phone prefix) and count checks are deltas, never absolutes.
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
  smsOptOuts,
  smsThreadMessages,
  smsThreads,
} from '@/lib/db/schema';
import {
  loadInboxUnreadCount,
  loadSmsInbox,
} from '@/features/sms/conversations/queries';

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');

// Distinct from sms-service (+1999555) and sms-conversations (+1999556) so
// the three files' sweeps never touch each other's rows on the shared DB.
const PHONE_PREFIX = '+1999557';

type TestDb = PostgresJsDatabase<typeof schema>;

describe.skipIf(!dbUrl)('sms global inbox read model (0107)', () => {
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
    const threadIds = fixtures.campaignIds.length
      ? (
          await db
            .select({ id: smsThreads.id })
            .from(smsThreads)
            .where(inArray(smsThreads.campaignId, fixtures.campaignIds))
        ).map((t) => t.id)
      : [];
    if (threadIds.length) {
      await db
        .delete(smsThreadMessages)
        .where(inArray(smsThreadMessages.threadId, threadIds));
      await db.delete(smsThreads).where(inArray(smsThreads.id, threadIds));
    }
    if (fixtures.campaignIds.length) {
      await db.delete(campaigns).where(inArray(campaigns.id, fixtures.campaignIds));
    }
    if (fixtures.dealerIds.length) {
      await db.delete(dealers).where(inArray(dealers.id, fixtures.dealerIds));
    }
    await db.delete(smsOptOuts).where(like(smsOptOuts.phone, `${PHONE_PREFIX}%`));
    fixtures.dealerIds = [];
    fixtures.campaignIds = [];
  });

  async function seedCampaign(dealerName: string, startDate: string, endDate: string) {
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
        startDate,
        endDate,
        status: 'booked',
        smsEmail: 100,
      })
      .returning({ id: campaigns.id });
    fixtures.campaignIds.push(campaign.id);
    return campaign.id;
  }

  async function seedThread(
    campaignId: number,
    phone: string,
    over: Partial<typeof smsThreads.$inferInsert> = {},
  ) {
    const [thread] = await db
      .insert(smsThreads)
      .values({ campaignId, phone, ...over })
      .returning({ id: smsThreads.id });
    return thread.id;
  }

  it('aggregates threads across campaigns with dealer/event context, needs-action-first', async () => {
    const campaignA = await seedCampaign('Inbox Test Dealer A', '2026-08-01', '2026-08-02');
    const campaignB = await seedCampaign('Inbox Test Dealer B', '2026-09-05', '2026-09-05');

    const t0 = new Date('2026-07-10T12:00:00Z');
    const t1 = new Date('2026-07-11T12:00:00Z');
    const t2 = new Date('2026-07-12T12:00:00Z');

    // Unread thread on campaign A — OLDER activity than the read thread below,
    // so recency alone would sort it second; needs-action-first must win.
    const unreadPhone = `${PHONE_PREFIX}0001`;
    const unreadThread = await seedThread(campaignA, unreadPhone, {
      lastMessageAt: t1,
      lastInboundAt: t1,
      lastReadAt: null,
    });
    await db.insert(smsThreadMessages).values({
      threadId: unreadThread,
      direction: 'inbound',
      body: 'still interested, call me',
      createdAt: t1,
    });

    // Read thread on campaign B — newest activity, inbound already read, and
    // its number is in the opt-out registry.
    const readPhone = `${PHONE_PREFIX}0002`;
    const readThread = await seedThread(campaignB, readPhone, {
      lastMessageAt: t2,
      lastInboundAt: t0,
      lastReadAt: t2,
    });
    await db.insert(smsThreadMessages).values([
      { threadId: readThread, direction: 'inbound', body: 'what time?', createdAt: t0 },
      {
        threadId: readThread,
        direction: 'outbound',
        body: 'We open at 9.',
        status: 'delivered',
        createdAt: t2,
      },
    ]);
    await db.insert(smsOptOuts).values({ phone: readPhone, source: 'manual' });

    const inbox = await loadSmsInbox();
    const ours = inbox.filter((t) => t.phone.startsWith(PHONE_PREFIX));
    expect(ours).toHaveLength(2);

    // Needs-action-first: the unread thread sorts above the read one even
    // though the read thread's activity is newer.
    expect(ours[0].id).toBe(unreadThread);
    expect(ours[1].id).toBe(readThread);

    // Row context comes from the campaign/dealer joins.
    expect(ours[0]).toMatchObject({
      campaignId: campaignA,
      dealerName: 'Inbox Test Dealer A',
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      unread: true,
      optedOut: false,
    });
    expect(ours[0].messages.map((m) => m.body)).toEqual(['still interested, call me']);

    expect(ours[1]).toMatchObject({
      campaignId: campaignB,
      dealerName: 'Inbox Test Dealer B',
      unread: false,
      optedOut: true,
    });
    expect(ours[1].messages.map((m) => m.direction)).toEqual(['inbound', 'outbound']);
  });

  it('tracks the unread count through inbound → read → new inbound', async () => {
    const campaignId = await seedCampaign('Inbox Count Dealer', '2026-08-01', '2026-08-01');
    const phone = `${PHONE_PREFIX}0003`;

    const baseline = await loadInboxUnreadCount();

    // Outbound-only thread (no inbound yet): not unread.
    const threadId = await seedThread(campaignId, phone, {
      lastMessageAt: new Date('2026-07-10T12:00:00Z'),
      lastInboundAt: null,
      lastReadAt: null,
    });
    expect(await loadInboxUnreadCount()).toBe(baseline);

    // Inbound lands → unread.
    await db
      .update(smsThreads)
      .set({
        lastInboundAt: new Date('2026-07-11T12:00:00Z'),
        lastMessageAt: new Date('2026-07-11T12:00:00Z'),
      })
      .where(eq(smsThreads.id, threadId));
    expect(await loadInboxUnreadCount()).toBe(baseline + 1);

    // Staff reads it → drops back.
    await db
      .update(smsThreads)
      .set({ lastReadAt: new Date('2026-07-11T12:05:00Z') })
      .where(eq(smsThreads.id, threadId));
    expect(await loadInboxUnreadCount()).toBe(baseline);

    // A newer inbound after the read → unread again.
    await db
      .update(smsThreads)
      .set({
        lastInboundAt: new Date('2026-07-12T12:00:00Z'),
        lastMessageAt: new Date('2026-07-12T12:00:00Z'),
      })
      .where(eq(smsThreads.id, threadId));
    expect(await loadInboxUnreadCount()).toBe(baseline + 1);
  });
});
