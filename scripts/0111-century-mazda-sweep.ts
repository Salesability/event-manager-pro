// 0111 one-off: sweep the 2026-07-15 ad-hoc SMS fixtures (and the 2026-07-16
// dev-redirected test launch they fed) off the REAL Century Mazda campaign.
// The demo narrative now lives on the harness's Demo Motors campaign
// (scripts/seeds/) with invented names — these rows are replaced, not moved.
//
// Hard-scoped by inventory taken 2026-07-16 (see the 0111 plan):
//   campaign 92 (Century Mazda) · send 674 + its 4 message rows ·
//   6 fixture recipients (5× +1902555 fakes + the dev's own number) ·
//   the +19025550105 (Pat Doucette) manual opt-out.
// Nothing else on the campaign is touched; refuses non-sandbox targets.
//
// Usage:
//   pnpm exec tsx scripts/0111-century-mazda-sweep.ts

import { and, eq, inArray, like, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { smsMessages, smsOptOuts, smsRecipients, smsSends } from '../src/lib/db/schema';
import { classifySeedTarget } from './seeds/guard';

const CAMPAIGN_ID = 92;
const SEND_ID = 674;
const FIXTURE_PHONE_BLOCK = '+1902555%';
const DEV_PHONE = '+19028026215';
const FIXTURE_OPT_OUT = '+19025550105';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // fall through — the guard reports the missing URL
  }
}
// One-off against the shared sandbox only — no unknown-target opt-in here.
const verdict = classifySeedTarget(process.env.DATABASE_URL, false);
if (!verdict.ok) {
  console.error(`❌ ${verdict.reason}`);
  process.exit(1);
}

const pg = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(pg, { schema });

async function sweep() {
  console.log(`Sweeping 2026-07-15 fixtures off campaign ${CAMPAIGN_ID} (${verdict.ok ? verdict.label : ''})…`);

  const sendIds = (
    await db
      .select({ id: smsSends.id })
      .from(smsSends)
      .where(and(eq(smsSends.campaignId, CAMPAIGN_ID), eq(smsSends.id, SEND_ID)))
  ).map((s) => s.id);
  if (sendIds.length) {
    const messages = await db
      .delete(smsMessages)
      .where(inArray(smsMessages.sendId, sendIds))
      .returning({ id: smsMessages.id });
    const sends = await db
      .delete(smsSends)
      .where(and(eq(smsSends.campaignId, CAMPAIGN_ID), inArray(smsSends.id, sendIds)))
      .returning({ id: smsSends.id });
    console.log(`  ledger: ${messages.length} message(s), ${sends.length} send(s)`);
  } else {
    console.log('  ledger: already clean');
  }

  const recipients = await db
    .delete(smsRecipients)
    .where(
      and(
        eq(smsRecipients.campaignId, CAMPAIGN_ID),
        or(
          like(smsRecipients.phone, FIXTURE_PHONE_BLOCK),
          eq(smsRecipients.phone, DEV_PHONE),
        ),
      ),
    )
    .returning({ phone: smsRecipients.phone });
  console.log(`  recipients: ${recipients.length} removed`);

  const optOuts = await db
    .delete(smsOptOuts)
    .where(and(eq(smsOptOuts.phone, FIXTURE_OPT_OUT), eq(smsOptOuts.source, 'manual')))
    .returning({ phone: smsOptOuts.phone });
  console.log(`  opt-outs: ${optOuts.length} removed (${FIXTURE_OPT_OUT})`);

  console.log('Century Mazda campaign is back to its pre-2026-07-15 state.');
}

sweep()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pg.end({ timeout: 5 }));
