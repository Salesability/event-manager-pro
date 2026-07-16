import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inArray, like, notInArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres verification of the 0111 demo-seed harness contract:
// idempotency (seed twice → identical marker-scoped counts), scoped clean
// (zero marker rows after, zero non-marker rows touched throughout), and the
// prod-ref refusal at the CLI entry point (non-zero exit before any write).
// Drives the module `seed`/`clean` functions directly for the DB cases (same
// code path the runner walks) and spawns the real CLI for the guard case.
// `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

import * as schema from '@/lib/db/schema';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
  smsThreads,
} from '@/lib/db/schema';
import { demoDealerModule } from '../../scripts/seeds/10-demo-dealer';
import { smsRecipientsModule } from '../../scripts/seeds/20-sms-recipients';
import { replyTestersModule } from '../../scripts/seeds/25-reply-testers';
import { smsHistoryModule } from '../../scripts/seeds/30-sms-history';
import { classifySeedTarget } from '../../scripts/seeds/guard';
import { DEMO_PHONE_PREFIX, DEMO_PUBLIC_ID_PREFIX } from '../../scripts/seeds/markers';

try {
  process.loadEnvFile('.env.local');
} catch {
  // missing file → skipIf below handles it
}

const dbUrl = process.env.DATABASE_URL;
const targetVerdict = classifySeedTarget(dbUrl, false);
const pg = targetVerdict.ok ? postgres(dbUrl!, { prepare: false }) : null;
const db = pg ? drizzle(pg, { schema }) : null;

const MODULES = [demoDealerModule, smsRecipientsModule, replyTestersModule, smsHistoryModule];

async function seedAll() {
  for (const mod of [...MODULES].reverse()) await mod.clean(db!);
  for (const mod of MODULES) await mod.seed(db!);
}

async function cleanAll() {
  for (const mod of [...MODULES].reverse()) await mod.clean(db!);
}

/** Marker-scoped row counts across every table the harness writes. */
async function markerCounts() {
  const demoCampaignIds = (
    await db!
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(like(campaigns.publicId, `${DEMO_PUBLIC_ID_PREFIX}%`))
  ).map((c) => c.id);
  const [row] = await db!
    .select({
      dealers: sql<number>`(select count(*) from ${dealers} where ${dealers.publicId} like ${`${DEMO_PUBLIC_ID_PREFIX}%`})::int`,
      optOuts: sql<number>`(select count(*) from ${smsOptOuts} where ${smsOptOuts.phone} like ${`${DEMO_PHONE_PREFIX}%`})::int`,
    })
    .from(sql`(select 1) as one`);
  // Campaign-scoped, not phone-prefix: the reply-tester module (25) puts
  // real staff numbers on the demo campaign; they must count and clean.
  const recipients = demoCampaignIds.length
    ? await db!
        .select({ n: sql<number>`count(*)::int` })
        .from(smsRecipients)
        .where(inArray(smsRecipients.campaignId, demoCampaignIds))
    : [{ n: 0 }];
  const sends = demoCampaignIds.length
    ? await db!
        .select({ id: smsSends.id })
        .from(smsSends)
        .where(inArray(smsSends.campaignId, demoCampaignIds))
    : [];
  const messages = sends.length
    ? await db!
        .select({ n: sql<number>`count(*)::int` })
        .from(smsMessages)
        .where(inArray(smsMessages.sendId, sends.map((s) => s.id)))
    : [{ n: 0 }];
  const threads = demoCampaignIds.length
    ? await db!
        .select({ n: sql<number>`count(*)::int` })
        .from(smsThreads)
        .where(inArray(smsThreads.campaignId, demoCampaignIds))
    : [{ n: 0 }];
  return {
    dealers: row.dealers,
    campaigns: demoCampaignIds.length,
    recipients: recipients[0].n,
    optOuts: row.optOuts,
    sends: sends.length,
    messages: messages[0].n,
    threads: threads[0].n,
  };
}

/** Non-marker row counts for the same tables — must never move. */
async function nonMarkerCounts() {
  const demoCampaignIds = (
    await db!
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(like(campaigns.publicId, `${DEMO_PUBLIC_ID_PREFIX}%`))
  ).map((c) => c.id);
  const [row] = await db!
    .select({
      dealers: sql<number>`(select count(*) from ${dealers} where ${dealers.publicId} not like ${`${DEMO_PUBLIC_ID_PREFIX}%`})::int`,
      campaigns: sql<number>`(select count(*) from ${campaigns} where ${campaigns.publicId} not like ${`${DEMO_PUBLIC_ID_PREFIX}%`})::int`,
      recipients: sql<number>`(select count(*) from ${smsRecipients} where ${smsRecipients.phone} not like ${`${DEMO_PHONE_PREFIX}%`})::int`,
      optOuts: sql<number>`(select count(*) from ${smsOptOuts} where ${smsOptOuts.phone} not like ${`${DEMO_PHONE_PREFIX}%`})::int`,
    })
    .from(sql`(select 1) as one`);
  const sends = demoCampaignIds.length
    ? await db!
        .select({ n: sql<number>`count(*)::int` })
        .from(smsSends)
        .where(notInArray(smsSends.campaignId, demoCampaignIds))
    : await db!.select({ n: sql<number>`count(*)::int` }).from(smsSends);
  return { ...row, sends: sends[0].n };
}

afterAll(async () => {
  // Leave the shared sandbox with zero marker rows; `pnpm seed:demo` restores
  // the demo state in one command whenever it's next needed.
  if (db) await cleanAll();
  await pg?.end({ timeout: 5 });
});

describe.skipIf(!targetVerdict.ok)('demo-seed harness (0111)', () => {
  it(
    'is idempotent: seed twice → identical marker-scoped counts; clean → zero marker rows; non-marker rows never move',
    { timeout: 60_000 },
    async () => {
      const baseline = await nonMarkerCounts();

      await seedAll();
      const first = await markerCounts();
      expect(first).toEqual({
        dealers: 1,
        campaigns: 1,
        recipients: 8,
        optOuts: 1,
        sends: 1,
        messages: 7,
        threads: 1,
      });

      await seedAll();
      expect(await markerCounts()).toEqual(first);

      await cleanAll();
      expect(await markerCounts()).toEqual({
        dealers: 0,
        campaigns: 0,
        recipients: 0,
        optOuts: 0,
        sends: 0,
        messages: 0,
        threads: 0,
      });

      expect(await nonMarkerCounts()).toEqual(baseline);
    },
  );

  it(
    'CLI refuses a prod-ref DATABASE_URL with a non-zero exit before any write',
    { timeout: 30_000 },
    async () => {
      const prodUrl =
        'postgresql://postgres.fkfybeddnfxnjuxkqidp:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres';
      let exitCode = 0;
      let output = '';
      try {
        await promisify(execFile)('node_modules/.bin/tsx', ['scripts/seeds/index.ts'], {
          env: {
            ...process.env,
            DATABASE_URL: prodUrl,
            SEED_DEMO_ALLOW_UNKNOWN_TARGET: '1', // must NOT admit prod
            NODE_OPTIONS: '--conditions=react-server',
          },
        });
      } catch (err) {
        const e = err as { code?: number; stderr?: string; stdout?: string };
        exitCode = e.code ?? -1;
        output = `${e.stderr ?? ''}${e.stdout ?? ''}`;
      }
      expect(exitCode).toBe(1);
      expect(output).toContain('PRODUCTION');
    },
  );
});
