import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres round-trip for the 0103 Phase 2 SMS schema: campaign →
// recipients → send → messages insert chain, the permanent-ledger contract
// (recipient delete leaves the message row with its phone snapshot, D5), the
// global opt-out uniqueness, and the E.164 CHECK guards. Every case runs
// inside an always-rolled-back transaction, so nothing persists to the shared
// sandbox DB. `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

import * as schema from '@/lib/db/schema';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
} from '@/lib/db/schema';

try {
  process.loadEnvFile('.env.local');
} catch {
  // missing file → skipIf below handles it
}

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

// Drizzle wraps constraint violations in a `Failed query: …` error with the
// postgres.js original on `cause` — flatten the chain for assertion.
function errorChain(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  while (cur instanceof Error) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.join(' <- ');
}

async function expectDbError(run: () => Promise<unknown>, pattern: RegExp) {
  let chain = '';
  try {
    await run();
  } catch (err) {
    chain = errorChain(err);
  }
  expect(chain).toMatch(pattern);
}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('sms schema (0103 Phase 2)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function seedCampaign(tx: Tx) {
    const [dealer] = await tx
      .insert(dealers)
      .values({ publicId: publicId(), name: 'SMS Schema Dealer' })
      .returning({ id: dealers.id });
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        publicId: publicId(),
        dealerId: dealer.id,
        startDate: '2026-08-01',
        endDate: '2026-08-02',
      })
      .returning({ id: campaigns.id });
    return campaign.id;
  }

  it('round-trips campaign → recipients → send → messages', async () => {
    let message:
      | { phone: string; status: string; recipientId: number | null }
      | undefined;

    try {
      await db.transaction(async (tx) => {
        const campaignId = await seedCampaign(tx);
        const [recipient] = await tx
          .insert(smsRecipients)
          .values({
            campaignId,
            phone: '+19025551234',
            firstName: 'Pat',
            consentBasis: 'implied_purchase',
            lastContactAt: '2026-01-15',
          })
          .returning({ id: smsRecipients.id });
        const [send] = await tx
          .insert(smsSends)
          .values({
            campaignId,
            body: 'Hi {{first_name}}, your event starts Saturday!',
            totalRecipients: 1,
            excludedOptOut: 0,
            excludedStaleConsent: 0,
          })
          .returning({ id: smsSends.id });
        await tx.insert(smsMessages).values({
          sendId: send.id,
          recipientId: recipient.id,
          phone: '+19025551234',
          providerSid: `SM_${publicId()}`,
        });

        [message] = await tx
          .select({
            phone: smsMessages.phone,
            status: smsMessages.status,
            recipientId: smsMessages.recipientId,
          })
          .from(smsMessages)
          .where(eq(smsMessages.sendId, send.id));

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(message).toBeDefined();
    expect(message!.phone).toBe('+19025551234');
    expect(message!.status).toBe('queued');
    expect(message!.recipientId).not.toBeNull();
  });

  it('recipient delete (retention purge, D5) leaves the message row with phone + 0105 send-event snapshots intact', async () => {
    let after:
      | {
          phone: string;
          recipientId: number | null;
          consentBasis: string | null;
          lastContactAt: string | null;
          identityHmac: string | null;
        }
      | undefined;

    try {
      await db.transaction(async (tx) => {
        const campaignId = await seedCampaign(tx);
        const [recipient] = await tx
          .insert(smsRecipients)
          .values({
            campaignId,
            phone: '+19025557777',
            consentBasis: 'implied_purchase',
            lastContactAt: '2026-01-15',
            identityHmac: 'a'.repeat(64),
          })
          .returning({ id: smsRecipients.id });
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
        const [msg] = await tx
          .insert(smsMessages)
          .values({
            sendId: send.id,
            recipientId: recipient.id,
            phone: '+19025557777',
            status: 'delivered',
            // 0105: launch stamps these snapshots so the ledger stays a
            // self-sufficient CASL record after the purge.
            consentBasis: 'implied_purchase',
            lastContactAt: '2026-01-15',
            identityHmac: 'a'.repeat(64),
          })
          .returning({ id: smsMessages.id });

        // The 24-month purge deletes the recipient row.
        await tx.delete(smsRecipients).where(eq(smsRecipients.id, recipient.id));

        [after] = await tx
          .select({
            phone: smsMessages.phone,
            recipientId: smsMessages.recipientId,
            consentBasis: smsMessages.consentBasis,
            lastContactAt: smsMessages.lastContactAt,
            identityHmac: smsMessages.identityHmac,
          })
          .from(smsMessages)
          .where(eq(smsMessages.id, msg.id));

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }

    expect(after).toEqual({
      phone: '+19025557777',
      recipientId: null,
      consentBasis: 'implied_purchase',
      lastContactAt: '2026-01-15',
      identityHmac: 'a'.repeat(64),
    });
  });

  it('opt-outs are globally unique on phone', async () => {
    await expectDbError(
      () =>
        db.transaction(async (tx) => {
          await tx
            .insert(smsOptOuts)
            .values({ phone: '+19025550000', source: 'stop_reply' });
          await tx
            .insert(smsOptOuts)
            .values({ phone: '+19025550000', source: 'manual' });
          throw new Rollback();
        }),
      /sms_opt_outs_phone_unique|duplicate key/,
    );
  });

  it('the same phone may appear on two different campaigns but not twice in one', async () => {
    await expectDbError(
      () =>
        db.transaction(async (tx) => {
          const campaignA = await seedCampaign(tx);
          const campaignB = await seedCampaign(tx);
          // Cross-campaign duplicate is fine (dealer lists overlap).
          await tx.insert(smsRecipients).values([
            { campaignId: campaignA, phone: '+19025551111', consentBasis: 'express' },
            { campaignId: campaignB, phone: '+19025551111', consentBasis: 'express' },
          ]);
          // Same campaign twice violates the composite unique.
          await tx.insert(smsRecipients).values({
            campaignId: campaignA,
            phone: '+19025551111',
            consentBasis: 'express',
          });
          throw new Rollback();
        }),
      /sms_recipients_campaign_phone_unique|duplicate key/,
    );
  });

  it('rejects a non-E.164 phone at the DB (CHECK constraint)', async () => {
    await expectDbError(
      () =>
        db.transaction(async (tx) => {
          const campaignId = await seedCampaign(tx);
          await tx
            .insert(smsRecipients)
            .values({ campaignId, phone: '902-555-1234', consentBasis: 'express' });
          throw new Rollback();
        }),
      /sms_recipients_phone_e164_check|check constraint/,
    );
  });

  it('sms_message_status enum exposes the Twilio lifecycle values', async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      select e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'sms_message_status'
      order by e.enumsortorder
    `;
    expect(rows.map((r) => r.enumlabel)).toEqual([
      'queued',
      'sent',
      'delivered',
      'undelivered',
      'failed',
    ]);
  });
});
