// 0103 D5 retention purge: hard-delete dealer-supplied SMS recipient rows
// 24 months after import (`sms_recipients.created_at`). The message ledger
// survives by design — `sms_messages.recipient_id` is ON DELETE SET NULL with
// the phone snapshotted on the message row — and `sms_opt_outs` is never
// touched (permanent compliance registry).
//
// Usage (defaults to a DRY RUN — prints what would be deleted):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/purge-sms-recipients.ts
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/purge-sms-recipients.ts --delete
//
// Run against prod via scripts/with-prod-db.sh. Intended cadence: manual /
// periodic ops task; the eligibility predicate already stops sends to stale
// recipients long before the purge boundary, so purge timing is a retention
// obligation, not a send-correctness gate.

import { lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { smsRecipients } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local first)');
  process.exit(1);
}

const RETENTION_MONTHS = 24;

async function main() {
  const write = process.argv.includes('--delete');
  const client = postgres(DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(client, { schema });

  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);

  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(smsRecipients)
      .where(lt(smsRecipients.createdAt, cutoff));

    if (!write) {
      console.log(
        `[dry-run] ${count} sms_recipients row(s) imported before ${cutoff.toISOString()} would be deleted. Re-run with --delete to purge.`,
      );
      return;
    }

    const deleted = await db
      .delete(smsRecipients)
      .where(lt(smsRecipients.createdAt, cutoff))
      .returning({ id: smsRecipients.id });
    console.log(
      `Purged ${deleted.length} sms_recipients row(s) imported before ${cutoff.toISOString()} (ledger rows keep their phone snapshots; recipient_id set NULL).`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
