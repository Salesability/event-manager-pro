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

// Mock the vendor boundary only (never a real Twilio call from tests); the
// dev-redirect doctrine in `sendSms` still runs for real, so the reply test
// proves the redirect below.
const twilioMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/sms/client', () => ({
  client: () => ({
    ok: true,
    client: { messages: { create: twilioMocks.create } },
    messagingServiceSid: 'MG_test',
  }),
  __resetForTests: () => {},
}));

// MUST precede every `@/…` import: the route handler's chain evaluates the
// app db pool, which reads DATABASE_URL at import time.
import './helpers/load-env';

import * as schema from '@/lib/db/schema';
import {
  authUsers,
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '@/lib/db/schema';
import {
  loadCampaignConversations,
  loadReassignCandidates,
} from '@/features/sms/conversations/queries';
import { sendThreadReply } from '@/lib/sms/conversations';
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
    // Deterministic redirect decision for the reply test: never production,
    // always a dev target.
    process.env.APP_ENV = 'development';
    process.env.SMS_DEV_TO = '+15005550006';
    // Keyless → the 0110 inbound classifier no-ops (its documented
    // degradation) instead of making a REAL Anthropic call from tests.
    // 0110's own integration file mocks the SDK to test the stamp.
    delete process.env.ANTHROPIC_API_KEY;
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

    // D2 reassign candidates: exactly the OTHER campaign that texted this
    // number (attribution can only be wrong between campaigns sharing it).
    const candidates = await loadReassignCandidates(threads[0].id);
    expect(candidates.map((c) => c.campaignId)).toEqual([olderCampaign]);
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

  // Long timeout: this walks reply → callback → STOP → refusal, each a round
  // trip to the remote sandbox pooler.
  it('staff reply: persist-first outbound, dev-redirect, read-marker clear, STOP halt (Phase 3)', { timeout: 30_000 }, async () => {
    const phone = `${PHONE_PREFIX}0005`;
    const { campaignId } = await seedCampaignWithSend(phone);
    // Actor FK requires a real auth.users row; any sandbox user will do.
    const [user] = await db.select({ id: authUsers.id }).from(authUsers).limit(1);
    expect(user).toBeDefined();

    await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: 'interested — what time do you open?',
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );

    // Unread until someone reads or replies.
    let [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.unread).toBe(true);
    expect(conversation.optedOut).toBe(false);

    const replySid = `SMreply_${publicId()}`;
    twilioMocks.create.mockResolvedValueOnce({ sid: replySid });
    // aiDrafted: the approved-AI-draft provenance flag (0106 Phase 4) must
    // persist through the round trip onto the message row.
    const result = await sendThreadReply({
      threadId: conversation.id,
      body: 'We open at 9am — reply with a time and we will book you in.',
      userId: user.id,
      aiDrafted: true,
    });
    expect(result).toEqual({ ok: true, messageId: expect.any(Number) });

    // The dispatch was dev-redirected: Twilio was addressed at SMS_DEV_TO
    // with the real recipient folded into the body prefix.
    expect(twilioMocks.create).toHaveBeenCalledTimes(1);
    const createArgs = twilioMocks.create.mock.calls[0][0];
    expect(createArgs.to).toBe('+15005550006');
    expect(createArgs.body).toContain(`[DEV→${phone}]`);

    // Persisted outbound row carries the sid + actor; replying cleared unread.
    [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.unread).toBe(false);
    expect(conversation.messages).toHaveLength(2);
    const outbound = conversation.messages[1];
    expect(outbound.direction).toBe('outbound');
    expect(outbound.status).toBe('queued');
    expect(outbound.aiDrafted).toBe(true);
    const [outboundRow] = await db
      .select({ providerSid: smsThreadMessages.providerSid, createdById: smsThreadMessages.createdById })
      .from(smsThreadMessages)
      .where(eq(smsThreadMessages.id, outbound.id));
    expect(outboundRow.providerSid).toBe(replySid);
    expect(outboundRow.createdById).toBe(user.id);

    // A status callback for the reply sid flips the thread-message ledger.
    const cbRes = await POST(
      signedRequest({ MessageSid: replySid, MessageStatus: 'delivered' }) as never,
    );
    expect(cbRes.status).toBe(200);
    [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.messages[1].status).toBe('delivered');

    // STOP mid-thread → the reply path is refused before any dispatch.
    await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: 'STOP',
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );
    [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.optedOut).toBe(true);
    const halted = await sendThreadReply({
      threadId: conversation.id,
      body: 'this must never send',
      userId: user.id,
    });
    expect(halted).toEqual({ error: expect.stringContaining('opted out') });
    expect(twilioMocks.create).toHaveBeenCalledTimes(1);
    // No outbound row was persisted for the refused reply.
    [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.messages.filter((m) => m.direction === 'outbound')).toHaveLength(1);
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
