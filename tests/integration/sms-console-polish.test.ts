import { randomBytes } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres checks for 0110 (console polish), through the REAL webhook
// route POST with signed Twilio payloads — same harness as
// sms-conversations.test.ts (committed fixtures + afterEach sweeps):
//   • display-name snapshot stamped at thread creation from the campaign's
//     recipient row, and SURVIVING a recipient purge (the point of the copy);
//   • turn-state flips: inbound → awaiting your reply, staff reply → waiting
//     on customer;
//   • the funnel numbers reconcile with seeded fixtures (send log + threads +
//     opt-out registry);
//   • the auto-classifier (owner-blessed, decision.md D1) stamps the enums on
//     inbound — with the SDK mocked; no real Anthropic call leaves a test.
//
// `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

// Mock BOTH vendor boundaries: Twilio (replies) and Anthropic (classifier).
const twilioMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/sms/client', () => ({
  client: () => ({
    ok: true,
    client: { messages: { create: twilioMocks.create } },
    messagingServiceSid: 'MG_test',
  }),
  __resetForTests: () => {},
}));
const anthropicMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: anthropicMocks.create };
  },
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
  smsRecipients,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '@/lib/db/schema';
import { loadCampaignConversations } from '@/features/sms/conversations/queries';
import { loadSmsCampaignFunnel } from '@/features/sms/queries';
import { sendThreadReply } from '@/lib/sms/conversations';
import { computeTwilioSignature } from '@/lib/sms/webhook-verify';
import { POST } from '@/app/api/twilio/webhook/route';

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');

const SITE_URL = 'https://sms-test.example.test';
const WEBHOOK_URL = `${SITE_URL}/api/twilio/webhook`;
const AUTH_TOKEN = 'sms-integration-test-token';
// Distinct prefix from sms-service (+1999555) and sms-conversations
// (+1999556) so the three files' sweeps never touch each other's rows.
const PHONE_PREFIX = '+1999557';

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

function classifierReturns(sentiment: string, temperature: string) {
  anthropicMocks.create.mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ sentiment, temperature }) }],
  });
}

describe.skipIf(!dbUrl)('sms console polish (0110)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  const ORIGINAL_ENV = { ...process.env };
  const fixtures = { dealerIds: [] as number[], campaignIds: [] as number[] };

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.SITE_URL = SITE_URL;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.APP_ENV = 'development';
    process.env.SMS_DEV_TO = '+15005550006';
    // A key must be SET for the classifier to run — the SDK is mocked above,
    // so no real call can leave the test either way.
    process.env.ANTHROPIC_API_KEY = 'integration-test-key';
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  afterEach(async () => {
    anthropicMocks.create.mockReset();
    twilioMocks.create.mockReset();
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
        .delete(smsRecipients)
        .where(inArray(smsRecipients.campaignId, fixtures.campaignIds));
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

  // Campaign + launch send + one ledger message per phone + (optionally) a
  // named recipient row — the full fixture the 0110 reads derive from.
  async function seedCampaign(
    phones: Array<{ phone: string; firstName?: string; lastName?: string; status?: string }>,
  ) {
    const [dealer] = await db
      .insert(dealers)
      .values({ publicId: publicId(), name: '0110 Polish Test Dealer' })
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
        totalRecipients: phones.length,
        excludedOptOut: 0,
        excludedStaleConsent: 0,
      })
      .returning({ id: smsSends.id });
    for (const p of phones) {
      await db.insert(smsMessages).values({
        sendId: send.id,
        phone: p.phone,
        providerSid: `SMout_${publicId()}`,
        status: (p.status ?? 'delivered') as never,
      });
      if (p.firstName || p.lastName) {
        await db.insert(smsRecipients).values({
          campaignId: campaign.id,
          phone: p.phone,
          firstName: p.firstName ?? null,
          lastName: p.lastName ?? null,
          consentBasis: 'express',
        });
      }
    }
    return { campaignId: campaign.id };
  }

  async function inbound(phone: string, body: string) {
    const res = await POST(
      signedRequest({
        SmsStatus: 'received',
        From: phone,
        Body: body,
        MessageSid: `SMin_${publicId()}`,
      }) as never,
    );
    expect(res.status).toBe(200);
  }

  it('snapshots the recipient name onto the thread and survives a purge', async () => {
    const phone = `${PHONE_PREFIX}0001`;
    const { campaignId } = await seedCampaign([
      { phone, firstName: 'Sarah', lastName: 'Tester' },
    ]);
    classifierReturns('positive', 'hot');

    await inbound(phone, 'interested! what time?');

    let [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.displayName).toBe('Sarah Tester');

    // The 24-month retention purge hard-deletes the recipient row; the
    // thread's snapshot is the whole point — the name must not blank.
    await db.delete(smsRecipients).where(eq(smsRecipients.campaignId, campaignId));
    [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.displayName).toBe('Sarah Tester');
  });

  it('leaves displayName null for a number not on the campaign list', async () => {
    const phone = `${PHONE_PREFIX}0002`;
    const { campaignId } = await seedCampaign([{ phone }]); // messaged, no recipient row
    classifierReturns('neutral', 'warm');

    await inbound(phone, 'who is this?');
    const [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.displayName).toBeNull();
  });

  it('turn-state flips from awaiting-your-reply to waiting-on-customer on a staff reply', async () => {
    const phone = `${PHONE_PREFIX}0003`;
    const { campaignId } = await seedCampaign([
      { phone, firstName: 'Flip', lastName: 'Case' },
    ]);
    classifierReturns('positive', 'hot');
    const [user] = await db.select({ id: authUsers.id }).from(authUsers).limit(1);
    expect(user).toBeDefined();

    await inbound(phone, 'can I come saturday?');
    let [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.awaitingReply).toBe(true);

    twilioMocks.create.mockResolvedValueOnce({ sid: `SMreply_${publicId()}` });
    const result = await sendThreadReply({
      threadId: conversation.id,
      body: 'Saturday works — 10am?',
      userId: user.id,
    });
    expect(result).toEqual({ ok: true, messageId: expect.any(Number) });

    [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.awaitingReply).toBe(false);

    // Their next message hands the ball back.
    await inbound(phone, 'yes perfect');
    [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.awaitingReply).toBe(true);
  });

  it('stamps the classifier enums on inbound and reconciles the funnel numbers', async () => {
    const responder = `${PHONE_PREFIX}0004`;
    const silent = `${PHONE_PREFIX}0005`;
    const stopper = `${PHONE_PREFIX}0006`;
    const { campaignId } = await seedCampaign([
      { phone: responder, firstName: 'Rae', lastName: 'Sponder', status: 'delivered' },
      { phone: silent, status: 'sent' },
      { phone: stopper, status: 'delivered' },
    ]);
    classifierReturns('positive', 'hot');

    await inbound(responder, 'book me in!');
    await inbound(stopper, 'STOP');

    // The auto-classifier ran on the non-STOP inbound and stamped the thread.
    const [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.sentiment).toBe('positive');
    expect(conversation.prospectTemperature).toBe('hot');
    expect(anthropicMocks.create).toHaveBeenCalledTimes(1);
    const [threadRow] = await db
      .select({ classifiedAt: smsThreads.classifiedAt })
      .from(smsThreads)
      .where(eq(smsThreads.campaignId, campaignId));
    expect(threadRow.classifiedAt).not.toBeNull();

    // Funnel: 3 messages sent (2 delivered); 1 responding thread (the STOP
    // never created one — no prior thread for that phone); 2 messaged phones
    // without a reply; 1 messaged phone in the opt-out registry.
    const funnel = await loadSmsCampaignFunnel(campaignId);
    expect(funnel).toEqual({
      sent: 3,
      delivered: 2,
      responses: 1,
      noResponse: 2,
      stops: 1,
    });

    // STOP always wins (eval fix): a mid-thread STOP clears the AI labels —
    // a halted thread must not keep wearing a stale "hot prospect" badge.
    await inbound(responder, 'STOP');
    const [halted] = await loadCampaignConversations(campaignId);
    expect(halted.optedOut).toBe(true);
    expect(halted.sentiment).toBeNull();
    expect(halted.prospectTemperature).toBeNull();
  });

  it('a classifier failure never blocks the inbound capture (best-effort)', async () => {
    const phone = `${PHONE_PREFIX}0007`;
    const { campaignId } = await seedCampaign([
      { phone, firstName: 'Best', lastName: 'Effort' },
    ]);
    anthropicMocks.create.mockRejectedValue(new Error('anthropic down'));

    await inbound(phone, 'hello?');

    const [conversation] = await loadCampaignConversations(campaignId);
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.displayName).toBe('Best Effort');
    expect(conversation.sentiment).toBeNull();
    expect(conversation.prospectTemperature).toBeNull();
  });
});
