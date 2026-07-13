import { randomBytes } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
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

// MUST precede every `@/…` import: the route handler's chain evaluates the
// app db pool, which reads DATABASE_URL at import time.
import './helpers/load-env';

import * as schema from '@/lib/db/schema';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
} from '@/lib/db/schema';
import { evaluateCampaignRecipients } from '@/features/sms/queries';
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

  afterEach(async () => {
    // Belt-and-braces: no fixture rows with the test prefix survive a failure.
    await db
      .delete(smsRecipients)
      .where(like(smsRecipients.phone, `${PHONE_PREFIX}%`));
  });
});
