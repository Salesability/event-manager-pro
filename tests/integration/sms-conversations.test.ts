import { randomBytes } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres checks for 0106 Phase 2 — inbound conversation capture through
// the REAL webhook route POST with signed Twilio payloads (committed fixtures,
// try/finally + afterEach sweeps — the route runs on the app pool):
//   • non-STOP inbound after a launch send → thread created on the right
//     campaign, message persisted, sid replay idempotent (no dup, no re-bump);
//   • multi-campaign number → attribution follows the most recent send;
//   • STOP mid-thread → permanent opt-out AND the STOP appended as thread
//     evidence; STOP/chatty inbound with no campaign history → no thread.
//
// `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

// MUST precede every `@/…` import: the route handler's chain evaluates the
// app db pool, which reads DATABASE_URL at import time.
import './helpers/load-env';

import * as schema from '@/lib/db/schema';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '@/lib/db/schema';
import { computeTwilioSignature } from '@/lib/sms/webhook-verify';
import { POST } from '@/app/api/twilio/webhook/route';

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');

const SITE_URL = 'https://sms-test.example.test';
const WEBHOOK_URL = `${SITE_URL}/api/twilio/webhook`;
const AUTH_TOKEN = 'sms-integration-test-token';
// Distinct from sms-service.test.ts's +1999555 so the two files' sweeps
// never touch each other's rows on the shared sandbox DB.
const PHONE_PREFIX = '+1999556';

type TestDb = PostgresJsDatabase<typeof schema>;

function signedRequest(params: Record<string, string>): Request {
  const body = new URLSearchParams(params).toString();
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': computeTwilioSignature(AUTH_TOKEN, WEBHOOK_URL, params),
    },
  });
}

describe.skipIf(!dbUrl)('sms inbound conversation capture (0106 Phase 2)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  const ORIGINAL_ENV = { ...process.env };
  // Everything seeded goes here so afterEach can sweep even on mid-test failure.
  const fixtures = { dealerIds: [] as number[], campaignIds: [] as number[] };

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.SITE_URL = SITE_URL;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  afterEach(async () => {
    // FK order: thread messages → threads → ledger messages → sends → campaigns
    // → dealers (threads/sends RESTRICT their campaign).
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
    await db.delete(smsMessages).where(like(smsMessages.phone, `${PHONE_PREFIX}%`));
    if (fixtures.campaignIds.length) {
      await db
        .delete(smsSends)
        .where(inArray(smsSends.campaignId, fixtures.campaignIds));
      await db
        .delete(campaigns)
        .where(inArray(campaigns.id, fixtures.campaignIds));
    }
    if (fixtures.dealerIds.length) {
      await db.delete(dealers).where(inArray(dealers.id, fixtures.dealerIds));
    }
    await db.delete(smsOptOuts).where(like(smsOptOuts.phone, `${PHONE_PREFIX}%`));
    fixtures.dealerIds = [];
    fixtures.campaignIds = [];
  });

  // Committed campaign + one launch send + one ledger message to `phone` —
  // the "we texted this number" history that inbound attribution reads.
  async function seedCampaignWithSend(phone: string) {
    const [dealer] = await db
      .insert(dealers)
      .values({ publicId: publicId(), name: 'SMS Conversation Test Dealer' })
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
      })
      .returning({ id: campaigns.id });
    fixtures.campaignIds.push(campaign.id);
    const [send] = await db
      .insert(smsSends)
      .values({
        campaignId: campaign.id,
        body: 'Fixture body',
        totalRecipients: 1,
        excludedOptOut: 0,
        excludedStaleConsent: 0,
      })
      .returning({ id: smsSends.id });
    await db.insert(smsMessages).values({
      sendId: send.id,
      phone,
      providerSid: `SMout_${publicId()}`,
      status: 'delivered',
    });
    return { campaignId: campaign.id };
  }

  async function threadRows(campaignId: number) {
    return db
      .select({
        id: smsThreads.id,
        phone: smsThreads.phone,
        lastInboundAt: smsThreads.lastInboundAt,
        lastMessageAt: smsThreads.lastMessageAt,
      })
      .from(smsThreads)
      .where(eq(smsThreads.campaignId, campaignId));
  }

  it('persists a non-STOP inbound as a thread message, idempotently on sid replay', async () => {
    const phone = `${PHONE_PREFIX}0001`;
    const { campaignId } = await seedCampaignWithSend(phone);

    const inbound = {
      SmsStatus: 'received',
      From: phone,
      To: '+18005550100',
      Body: 'interested! what time?',
      MessageSid: `SMin_${publicId()}`,
    };
    const res1 = await POST(signedRequest(inbound) as never);
    expect(res1.status).toBe(200);

    const threads = await threadRows(campaignId);
    expect(threads).toHaveLength(1);
    expect(threads[0].phone).toBe(phone);
    expect(threads[0].lastInboundAt).not.toBeNull();
    const bumpedAt = threads[0].lastInboundAt;

    let messages = await db
      .select({
        direction: smsThreadMessages.direction,
        body: smsThreadMessages.body,
        status: smsThreadMessages.status,
      })
      .from(smsThreadMessages)
      .where(eq(smsThreadMessages.threadId, threads[0].id));
    expect(messages).toEqual([
      { direction: 'inbound', body: 'interested! what time?', status: null },
    ]);

    // Replayed webhook (same MessageSid): no duplicate row, no unread re-bump.
    const res2 = await POST(signedRequest(inbound) as never);
    expect(res2.status).toBe(200);
    messages = await db
      .select({ direction: smsThreadMessages.direction, body: smsThreadMessages.body, status: smsThreadMessages.status })
      .from(smsThreadMessages)
      .where(eq(smsThreadMessages.threadId, threads[0].id));
    expect(messages).toHaveLength(1);
    const [threadAfter] = await threadRows(campaignId);
    expect(threadAfter.lastInboundAt).toEqual(bumpedAt);

    // A second, fresh inbound joins the SAME thread.
    const res3 = await POST(
      signedRequest({ ...inbound, Body: 'hello again', MessageSid: `SMin_${publicId()}` }) as never,
    );
    expect(res3.status).toBe(200);
    expect(await threadRows(campaignId)).toHaveLength(1);
    messages = await db
      .select({ body: smsThreadMessages.body, direction: smsThreadMessages.direction, status: smsThreadMessages.status })
      .from(smsThreadMessages)
      .where(eq(smsThreadMessages.threadId, threads[0].id));
    expect(messages).toHaveLength(2);
  });

  it('attributes a multi-campaign number to the most recent send', async () => {
    const phone = `${PHONE_PREFIX}0002`;
    const { campaignId: olderCampaign } = await seedCampaignWithSend(phone);
    const { campaignId: newerCampaign } = await seedCampaignWithSend(phone);

    const res = await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: 'is this about the weekend event?',
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );
    expect(res.status).toBe(200);

    expect(await threadRows(olderCampaign)).toHaveLength(0);
    const threads = await threadRows(newerCampaign);
    expect(threads).toHaveLength(1);
    expect(threads[0].phone).toBe(phone);
  });

  it('appends a mid-thread STOP as evidence AND writes the permanent opt-out', async () => {
    const phone = `${PHONE_PREFIX}0003`;
    const { campaignId } = await seedCampaignWithSend(phone);

    await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: 'interested',
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );
    const res = await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: 'STOP',
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );
    expect(res.status).toBe(200);

    const optOuts = await db
      .select({ source: smsOptOuts.source })
      .from(smsOptOuts)
      .where(eq(smsOptOuts.phone, phone));
    expect(optOuts).toEqual([{ source: 'stop_reply' }]);

    const [thread] = await threadRows(campaignId);
    const messages = await db
      .select({ body: smsThreadMessages.body })
      .from(smsThreadMessages)
      .where(eq(smsThreadMessages.threadId, thread.id));
    expect(messages.map((m) => m.body)).toEqual(['interested', 'STOP']);
  });

  it('never creates a thread for STOP or chatter from a number with no campaign history', async () => {
    const phone = `${PHONE_PREFIX}0004`;

    const chatty = await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: 'who is this?',
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );
    expect(chatty.status).toBe(200);

    const stop = await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: 'STOP',
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );
    expect(stop.status).toBe(200);

    const threads = await db
      .select({ id: smsThreads.id })
      .from(smsThreads)
      .where(eq(smsThreads.phone, phone));
    expect(threads).toEqual([]);
    // The STOP still lands in the permanent registry.
    const optOuts = await db
      .select({ id: smsOptOuts.id })
      .from(smsOptOuts)
      .where(eq(smsOptOuts.phone, phone));
    expect(optOuts).toHaveLength(1);
  });
});
