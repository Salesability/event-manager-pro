import { randomBytes } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres checks for the 0103 send path + webhook (Phase 6):
//   • opt-out + stale-consent exclusion provable via `evaluateCampaignRecipients`
//     against real rows (rolled-back tx);
//   • launch-shape transaction rollback (a bad message row aborts the send row);
//   • multi-step launch → message rows → webhook status flip / inbound STOP →
//     permanent opt-out, driven through the REAL route handler POST with a
//     correctly signed Twilio payload (committed fixtures, try/finally cleanup —
//     the route runs on the app pool, so these can't ride a rolled-back tx).
//
// `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

// The 0113 broadcast-gate tests drive the REAL `launchSmsSend` action, so the
// three boundaries it crosses are mocked: Twilio (dispatch), the Supabase
// session + capability gate (auth), and next/cache (revalidate outside a
// request). The webhook tests above don't touch any of these.
const twilioMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/sms/client', () => ({
  client: () => ({
    ok: true,
    client: { messages: { create: twilioMocks.create } },
    messagingServiceSid: 'MG_test',
  }),
}));
const sessionMocks = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/supabase/session', () => ({
  getUser: async () => ({ id: sessionMocks.userId, app_metadata: { role: 'admin' } }),
}));
vi.mock('@/lib/auth/assert-can', () => ({ assertCan: async () => {} }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// MUST precede every `@/…` import: the route handler's chain evaluates the
// app db pool, which reads DATABASE_URL at import time.
import './helpers/load-env';

import * as schema from '@/lib/db/schema';
import {
  auditLog,
  authUsers,
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
} from '@/lib/db/schema';
import { launchSmsSend } from '@/features/sms/actions';
import {
  campaignHasDispatchedSend,
  evaluateCampaignRecipients,
  loadRecipientHistory,
} from '@/features/sms/queries';
import { computeTwilioSignature } from '@/lib/sms/webhook-verify';
import { POST } from '@/app/api/twilio/webhook/route';

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');

const SITE_URL = 'https://sms-test.example.test';
const WEBHOOK_URL = `${SITE_URL}/api/twilio/webhook`;
const AUTH_TOKEN = 'sms-integration-test-token';
// Unlikely-but-valid E.164 prefix so cleanup can sweep by pattern without
// touching real rows on the shared sandbox DB.
const PHONE_PREFIX = '+1999555';

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

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

describe.skipIf(!dbUrl)('sms send path + webhook (0103 Phase 6)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(async () => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.SITE_URL = SITE_URL;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    // Keyless → the 0110 inbound classifier no-ops instead of making a REAL
    // Anthropic call from the webhook tests below.
    delete process.env.ANTHROPIC_API_KEY;
    // 0113 launch tests: dev-redirect posture (never a real number) + a real
    // auth user so `recordAudit`'s actor FK insert succeeds.
    process.env.APP_ENV = 'development';
    process.env.SMS_DEV_TO = '+15005550006';
    const [user] = await db.select({ id: authUsers.id }).from(authUsers).limit(1);
    expect(user).toBeDefined();
    sessionMocks.userId = user.id;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  async function seedCampaign(tx: Tx | TestDb) {
    const [dealer] = await tx
      .insert(dealers)
      .values({ publicId: publicId(), name: 'SMS Service Test Dealer' })
      .returning({ id: dealers.id });
    const [campaign] = await tx
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
    return { dealerId: dealer.id, campaignId: campaign.id };
  }

  it('excludes opted-out and stale-consent recipients from the evaluation (real rows)', async () => {
    let evaluation: Awaited<ReturnType<typeof evaluateCampaignRecipients>> | undefined;

    try {
      await db.transaction(async (tx) => {
        const { campaignId } = await seedCampaign(tx);
        await tx.insert(smsRecipients).values([
          // Eligible: express, no window.
          { campaignId, phone: `${PHONE_PREFIX}0001`, consentBasis: 'express' },
          // Eligible: implied purchase, fresh contact.
          {
            campaignId,
            phone: `${PHONE_PREFIX}0002`,
            consentBasis: 'implied_purchase',
            lastContactAt: '2026-01-01',
          },
          // Stale: implied inquiry, contact 2 years back.
          {
            campaignId,
            phone: `${PHONE_PREFIX}0003`,
            consentBasis: 'implied_inquiry',
            lastContactAt: '2024-07-01',
          },
          // Opted out (registered below) — express basis, still excluded.
          { campaignId, phone: `${PHONE_PREFIX}0004`, consentBasis: 'express' },
        ]);
        await tx
          .insert(smsOptOuts)
          .values({ phone: `${PHONE_PREFIX}0004`, source: 'stop_reply' });

        evaluation = await evaluateCampaignRecipients(campaignId, new Date(), tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(evaluation).toBeDefined();
    expect(evaluation!.summary).toEqual({
      total: 4,
      eligible: 2,
      excludedOptOut: 1,
      excludedStaleConsent: 1,
    });
    const excludedPhones = evaluation!.recipients
      .filter((r) => !r.eligibility.eligible)
      .map((r) => r.phone)
      .sort();
    expect(excludedPhones).toEqual([`${PHONE_PREFIX}0003`, `${PHONE_PREFIX}0004`]);
  });

  it('rolls back the whole launch transaction when a message row is invalid', async () => {
    let campaignId = -1;
    let threw = false;
    try {
      await db.transaction(async (tx) => {
        const seeded = await seedCampaign(tx);
        campaignId = seeded.campaignId;
        const [send] = await tx
          .insert(smsSends)
          .values({
            campaignId,
            body: 'Body',
            totalRecipients: 2,
            excludedOptOut: 0,
            excludedStaleConsent: 0,
          })
          .returning({ id: smsSends.id });
        // Second row violates the E.164 CHECK — the whole tx must abort,
        // taking the send row (and the campaign fixture) with it.
        await tx.insert(smsMessages).values([
          { sendId: send.id, phone: `${PHONE_PREFIX}0010` },
          { sendId: send.id, phone: 'not-a-phone' },
        ]);
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const orphaned = await db
      .select({ id: smsSends.id })
      .from(smsSends)
      .where(eq(smsSends.campaignId, campaignId));
    expect(orphaned).toEqual([]);
  });

  it('flips message status via the signed webhook, monotonically (committed fixture + real POST)', async () => {
    const sid = `SMtest_${publicId()}`;
    let fixtureIds: { dealerId: number; campaignId: number; sendId: number } | null = null;

    try {
      // Committed fixture — the route handler reads the app pool.
      const seeded = await seedCampaign(db);
      const [send] = await db
        .insert(smsSends)
        .values({
          campaignId: seeded.campaignId,
          body: 'Fixture body',
          totalRecipients: 1,
          excludedOptOut: 0,
          excludedStaleConsent: 0,
        })
        .returning({ id: smsSends.id });
      fixtureIds = { ...seeded, sendId: send.id };
      await db.insert(smsMessages).values({
        sendId: send.id,
        phone: `${PHONE_PREFIX}0020`,
        providerSid: sid,
      });

      // delivered flips the row forward…
      const res1 = await POST(
        signedRequest({ MessageSid: sid, MessageStatus: 'delivered' }) as never,
      );
      expect(res1.status).toBe(200);
      let [row] = await db
        .select({ status: smsMessages.status, statusUpdatedAt: smsMessages.statusUpdatedAt })
        .from(smsMessages)
        .where(eq(smsMessages.providerSid, sid));
      expect(row.status).toBe('delivered');
      expect(row.statusUpdatedAt).not.toBeNull();

      // …and a late out-of-order `sent` callback cannot regress it.
      const res2 = await POST(
        signedRequest({ MessageSid: sid, MessageStatus: 'sent' }) as never,
      );
      expect(res2.status).toBe(200);
      [row] = await db
        .select({ status: smsMessages.status, statusUpdatedAt: smsMessages.statusUpdatedAt })
        .from(smsMessages)
        .where(eq(smsMessages.providerSid, sid));
      expect(row.status).toBe('delivered');

      // Tampered signature never touches the DB.
      const badParams = { MessageSid: sid, MessageStatus: 'failed' };
      const res3 = await POST(
        new Request(WEBHOOK_URL, {
          method: 'POST',
          body: new URLSearchParams(badParams).toString(),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-twilio-signature': 'AAAA_not_a_real_signature',
          },
        }) as never,
      );
      expect(res3.status).toBe(401);
      [row] = await db
        .select({ status: smsMessages.status, statusUpdatedAt: smsMessages.statusUpdatedAt })
        .from(smsMessages)
        .where(eq(smsMessages.providerSid, sid));
      expect(row.status).toBe('delivered');

      // Unknown sid → 404 (lets a raced callback retry).
      const res4 = await POST(
        signedRequest({ MessageSid: 'SM_does_not_exist', MessageStatus: 'delivered' }) as never,
      );
      expect(res4.status).toBe(404);
    } finally {
      if (fixtureIds) {
        await db.delete(smsMessages).where(eq(smsMessages.sendId, fixtureIds.sendId));
        await db.delete(smsSends).where(eq(smsSends.id, fixtureIds.sendId));
        await db.delete(campaigns).where(eq(campaigns.id, fixtureIds.campaignId));
        await db.delete(dealers).where(eq(dealers.id, fixtureIds.dealerId));
      }
    }
  });

  it('captures an inbound STOP into the permanent opt-out registry, idempotently', async () => {
    const phone = `${PHONE_PREFIX}0030`;
    try {
      const stopParams = {
        SmsStatus: 'received',
        From: phone,
        To: '+18005550100',
        Body: 'STOP',
        MessageSid: `SMin_${publicId()}`,
      };
      const res1 = await POST(signedRequest(stopParams) as never);
      expect(res1.status).toBe(200);

      let rows = await db
        .select({ source: smsOptOuts.source })
        .from(smsOptOuts)
        .where(eq(smsOptOuts.phone, phone));
      expect(rows).toEqual([{ source: 'stop_reply' }]);

      // Replay / repeat STOP → still exactly one row.
      const res2 = await POST(signedRequest(stopParams) as never);
      expect(res2.status).toBe(200);
      rows = await db
        .select({ source: smsOptOuts.source })
        .from(smsOptOuts)
        .where(eq(smsOptOuts.phone, phone));
      expect(rows).toHaveLength(1);

      // A chatty non-STOP inbound is acked and ignored.
      const res3 = await POST(
        signedRequest({
          SmsStatus: 'received',
          From: `${PHONE_PREFIX}0031`,
          Body: 'when does the sale end',
        }) as never,
      );
      expect(res3.status).toBe(200);
      const chatty = await db
        .select({ id: smsOptOuts.id })
        .from(smsOptOuts)
        .where(eq(smsOptOuts.phone, `${PHONE_PREFIX}0031`));
      expect(chatty).toEqual([]);
    } finally {
      await db.delete(smsOptOuts).where(like(smsOptOuts.phone, `${PHONE_PREFIX}003%`));
    }
  });

  it('reconstitutes dealer-scoped history across a purge via the phone key + identity fingerprint (0105)', async () => {
    let entries: Awaited<ReturnType<typeof loadRecipientHistory>> | undefined;

    try {
      await db.transaction(async (tx) => {
        // Dealer with an OLD campaign whose recipients were already purged —
        // only the message ledger remains (recipient_id NULL, snapshots kept).
        const old = await seedCampaign(tx);
        const [oldSend] = await tx
          .insert(smsSends)
          .values({
            campaignId: old.campaignId,
            body: 'Old body',
            totalRecipients: 2,
            excludedOptOut: 0,
            excludedStaleConsent: 0,
          })
          .returning({ id: smsSends.id });
        await tx.insert(smsMessages).values([
          // Same person then and now (matching fingerprint), delivered twice.
          {
            sendId: oldSend.id,
            phone: `${PHONE_PREFIX}0040`,
            status: 'delivered',
            identityHmac: 'match'.padEnd(64, '0'),
          },
          {
            sendId: oldSend.id,
            phone: `${PHONE_PREFIX}0040`,
            status: 'sent',
            identityHmac: 'match'.padEnd(64, '0'),
          },
          // Number later recycled: the historical fingerprint differs.
          {
            sendId: oldSend.id,
            phone: `${PHONE_PREFIX}0041`,
            status: 'undelivered',
            identityHmac: 'old-owner'.padEnd(64, '0'),
          },
        ]);

        // The dealer signs on again: NEW campaign (same dealer), fresh import.
        const [newCampaign] = await tx
          .insert(campaigns)
          .values({
            publicId: publicId(),
            dealerId: old.dealerId,
            startDate: '2026-09-01',
            endDate: '2026-09-02',
            status: 'booked',
            smsEmail: 50,
          })
          .returning({ id: campaigns.id });
        await tx.insert(smsRecipients).values([
          {
            campaignId: newCampaign.id,
            phone: `${PHONE_PREFIX}0040`,
            consentBasis: 'express',
            identityHmac: 'match'.padEnd(64, '0'),
          },
          {
            campaignId: newCampaign.id,
            phone: `${PHONE_PREFIX}0041`,
            consentBasis: 'express',
            identityHmac: 'new-owner'.padEnd(64, '0'),
          },
          // No prior history — must not appear in the entries.
          {
            campaignId: newCampaign.id,
            phone: `${PHONE_PREFIX}0042`,
            consentBasis: 'express',
          },
        ]);

        // An unrelated dealer texting the same number must NOT leak in.
        const other = await seedCampaign(tx);
        const [otherSend] = await tx
          .insert(smsSends)
          .values({
            campaignId: other.campaignId,
            body: 'Other dealer body',
            totalRecipients: 1,
            excludedOptOut: 0,
            excludedStaleConsent: 0,
          })
          .returning({ id: smsSends.id });
        await tx.insert(smsMessages).values({
          sendId: otherSend.id,
          phone: `${PHONE_PREFIX}0042`,
          status: 'delivered',
        });

        entries = await loadRecipientHistory(newCampaign.id, tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(entries).toBeDefined();
    const byPhone = new Map(entries!.map((e) => [e.phone, e]));
    expect(byPhone.size).toBe(2); // 0042 has no history FOR THIS DEALER
    expect(byPhone.get(`${PHONE_PREFIX}0040`)).toMatchObject({
      priorCount: 2,
      identity: 'matches',
    });
    expect(byPhone.get(`${PHONE_PREFIX}0041`)).toMatchObject({
      priorCount: 1,
      lastStatus: 'undelivered',
      identity: 'differs',
    });
  });

  // ——— One broadcast per campaign (0113) ———
  // Committed fixtures + real `launchSmsSend` (Twilio/auth/cache mocked at the
  // file top): the gate must refuse a second launch once anything was
  // dispatched, but a fully-failed launch (no sid anywhere) stays retryable.

  function launchFormData(campaignId: number): FormData {
    const fd = new FormData();
    fd.set('campaignId', String(campaignId));
    fd.set('body', 'Broadcast gate test body');
    return fd;
  }

  async function cleanupCampaign(campaignId: number, dealerId: number) {
    const sends = await db
      .select({ id: smsSends.id })
      .from(smsSends)
      .where(eq(smsSends.campaignId, campaignId));
    if (sends.length) {
      const sendIds = sends.map((s) => s.id);
      await db.delete(auditLog).where(
        and(eq(auditLog.targetTable, 'sms_sends'), inArray(auditLog.targetId, sendIds)),
      );
      await db.delete(smsMessages).where(inArray(smsMessages.sendId, sendIds));
      await db.delete(smsSends).where(inArray(smsSends.id, sendIds));
    }
    await db.delete(smsRecipients).where(eq(smsRecipients.campaignId, campaignId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await db.delete(dealers).where(eq(dealers.id, dealerId));
  }

  it('refuses a second launch once any message row carries a provider sid (0113)', async () => {
    let fixture: { campaignId: number; dealerId: number } | null = null;
    try {
      fixture = await seedCampaign(db);
      const { campaignId } = fixture;
      await db.insert(smsRecipients).values({
        campaignId,
        phone: `${PHONE_PREFIX}0050`,
        consentBasis: 'express',
      });
      const [send] = await db
        .insert(smsSends)
        .values({
          campaignId,
          body: 'First broadcast',
          totalRecipients: 1,
          excludedOptOut: 0,
          excludedStaleConsent: 0,
        })
        .returning({ id: smsSends.id });
      // One dispatched, one crashed-queued — any sid at all closes the gate.
      await db.insert(smsMessages).values([
        { sendId: send.id, phone: `${PHONE_PREFIX}0050`, providerSid: `SMgate_${publicId()}` },
        { sendId: send.id, phone: `${PHONE_PREFIX}0051` },
      ]);

      const result = await launchSmsSend(launchFormData(campaignId));
      expect(result.data).toEqual({
        error:
          'This campaign has already been broadcast — see the send log below. Campaigns send one broadcast.',
      });
      expect(twilioMocks.create).not.toHaveBeenCalled();

      // The refusal rolled back inside the tx — no new send row.
      const sends = await db
        .select({ id: smsSends.id })
        .from(smsSends)
        .where(eq(smsSends.campaignId, campaignId));
      expect(sends).toEqual([{ id: send.id }]);
    } finally {
      if (fixture) await cleanupCampaign(fixture.campaignId, fixture.dealerId);
    }
  });

  it('allows a relaunch after a fully-failed launch (zero provider sids) (0113)', async () => {
    let fixture: { campaignId: number; dealerId: number } | null = null;
    try {
      fixture = await seedCampaign(db);
      const { campaignId } = fixture;
      await db.insert(smsRecipients).values({
        campaignId,
        phone: `${PHONE_PREFIX}0052`,
        consentBasis: 'express',
      });
      // A prior launch where every dispatch failed at Twilio: rows exist, no
      // sid anywhere — the campaign was never actually broadcast.
      const [failedSend] = await db
        .insert(smsSends)
        .values({
          campaignId,
          body: 'Failed broadcast',
          totalRecipients: 1,
          excludedOptOut: 0,
          excludedStaleConsent: 0,
          // Backdate past the 60-second just-launched window so only the
          // 0113 gate is under test.
          createdAt: new Date(Date.now() - 5 * 60_000),
        })
        .returning({ id: smsSends.id });
      await db.insert(smsMessages).values({
        sendId: failedSend.id,
        phone: `${PHONE_PREFIX}0052`,
        status: 'failed',
        errorCode: 'twilio_down',
      });

      twilioMocks.create.mockResolvedValueOnce({ sid: `SMretry_${publicId()}` });
      const result = await launchSmsSend(launchFormData(campaignId));
      expect(result.data).toMatchObject({ ok: true, accepted: 1, failed: 0 });

      const sends = await db
        .select({ id: smsSends.id })
        .from(smsSends)
        .where(eq(smsSends.campaignId, campaignId));
      expect(sends).toHaveLength(2);
    } finally {
      if (fixture) await cleanupCampaign(fixture.campaignId, fixture.dealerId);
    }
  });

  it('campaignHasDispatchedSend is false with no sends and flips on a sid (0113)', async () => {
    let before: boolean | undefined;
    let after: boolean | undefined;
    try {
      await db.transaction(async (tx) => {
        const { campaignId } = await seedCampaign(tx);
        before = await campaignHasDispatchedSend(campaignId, tx);
        const [send] = await tx
          .insert(smsSends)
          .values({
            campaignId,
            body: 'Body',
            totalRecipients: 1,
            excludedOptOut: 0,
            excludedStaleConsent: 0,
          })
          .returning({ id: smsSends.id });
        await tx.insert(smsMessages).values({
          sendId: send.id,
          phone: `${PHONE_PREFIX}0053`,
          providerSid: `SMflip_${publicId()}`,
        });
        after = await campaignHasDispatchedSend(campaignId, tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    expect(before).toBe(false);
    expect(after).toBe(true);
  });

  afterEach(async () => {
    twilioMocks.create.mockReset();
    // Belt-and-braces: no fixture rows with the test prefix survive a failure.
    await db
      .delete(smsRecipients)
      .where(like(smsRecipients.phone, `${PHONE_PREFIX}%`));
  });
});
