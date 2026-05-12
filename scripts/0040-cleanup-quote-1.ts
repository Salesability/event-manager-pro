// One-off cleanup for 0040-quote-send-receipts: drop the pre-chunk dev quote
// (#1) so a fresh send can populate the new `sent_to_email` / `sent_to_first_name`
// denorm and the panel-with-denorm path is exercisable end-to-end. The existing
// row was created before this chunk's columns shipped — its denorm is NULL,
// which makes the panel display "(recipient unknown)". Deleting + re-sending
// is the cleanest way to get a populated-denorm fixture.
//
// Deletion order (no DB cascades on these FKs):
//   1. null `campaigns.accepted_quote_id` for any campaign referencing the quote
//   2. null `quotes.previous_quote_id` for any quote-revision chain
//   3. DELETE audit_log rows for (target_table='quotes', target_id=<id>)
//   4. DELETE the quotes row
//   5. delete the GCS object at `quotes/<id>/<rev>.pdf` (5 revisions max — covers
//      the QUOTE_PDF_REVISION constant + future bumps)
//
// Dry-run (default; reports what would happen, no writes):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0040-cleanup-quote-1.ts
//
// Apply (single DB transaction; GCS deletes are best-effort after the txn):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0040-cleanup-quote-1.ts --apply

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Storage } from '@google-cloud/storage';
import * as schema from '../src/lib/db/schema';
import { auditLog, campaigns, quotes } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL');
  process.exit(1);
}

const QUOTE_ID = 1;
const GCS_BUCKET = process.env.GCS_BUCKET;
const args = process.argv.slice(2);
const apply = args.includes('--apply');

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

async function main() {
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Target: quote id=${QUOTE_ID}`);
  console.log();

  const [quote] = await db
    .select({
      id: quotes.id,
      status: quotes.status,
      dealerId: quotes.dealerId,
      pdfStorageKey: quotes.pdfStorageKey,
      previousQuoteId: quotes.previousQuoteId,
    })
    .from(quotes)
    .where(eq(quotes.id, QUOTE_ID))
    .limit(1);

  if (!quote) {
    console.log(`Quote #${QUOTE_ID} not found — nothing to do.`);
    await pg.end();
    return;
  }
  console.log('Quote row:', quote);

  const referencingCampaigns = await db
    .select({ id: campaigns.id, acceptedQuoteId: campaigns.acceptedQuoteId })
    .from(campaigns)
    .where(eq(campaigns.acceptedQuoteId, QUOTE_ID));
  console.log(`campaigns.accepted_quote_id references: ${referencingCampaigns.length}`);
  for (const c of referencingCampaigns) console.log('  ', c);

  const referencingPrev = await db
    .select({ id: quotes.id, previousQuoteId: quotes.previousQuoteId })
    .from(quotes)
    .where(eq(quotes.previousQuoteId, QUOTE_ID));
  console.log(`quotes.previous_quote_id references: ${referencingPrev.length}`);
  for (const q of referencingPrev) console.log('  ', q);

  const auditRows = await db
    .select({ id: auditLog.id, action: auditLog.action, payload: auditLog.payload })
    .from(auditLog)
    .where(sql`${auditLog.targetTable} = 'quotes' AND ${auditLog.targetId} = ${QUOTE_ID}`);
  console.log(`audit_log rows: ${auditRows.length}`);
  for (const a of auditRows) console.log('  ', a);

  console.log();
  console.log('Planned actions:');
  if (referencingCampaigns.length) {
    console.log(
      `  - UPDATE campaigns SET accepted_quote_id = NULL WHERE accepted_quote_id = ${QUOTE_ID} (${referencingCampaigns.length} rows)`,
    );
  }
  if (referencingPrev.length) {
    console.log(
      `  - UPDATE quotes SET previous_quote_id = NULL WHERE previous_quote_id = ${QUOTE_ID} (${referencingPrev.length} rows)`,
    );
  }
  if (auditRows.length) {
    console.log(
      `  - DELETE FROM audit_log WHERE target_table='quotes' AND target_id=${QUOTE_ID} (${auditRows.length} rows)`,
    );
  }
  console.log(`  - DELETE FROM quotes WHERE id = ${QUOTE_ID} (1 row)`);
  if (quote.pdfStorageKey) {
    console.log(`  - GCS delete: bucket=${GCS_BUCKET ?? '(unset)'} key=${quote.pdfStorageKey}`);
  } else {
    console.log('  - GCS delete: no pdf_storage_key on row; nothing to delete');
  }

  if (!apply) {
    console.log();
    console.log('Dry-run complete. Re-run with --apply to execute.');
    await pg.end();
    return;
  }

  console.log();
  console.log('Applying...');

  await db.transaction(async (tx) => {
    if (referencingCampaigns.length) {
      await tx
        .update(campaigns)
        .set({ acceptedQuoteId: null })
        .where(eq(campaigns.acceptedQuoteId, QUOTE_ID));
    }
    if (referencingPrev.length) {
      await tx
        .update(quotes)
        .set({ previousQuoteId: null })
        .where(eq(quotes.previousQuoteId, QUOTE_ID));
    }
    if (auditRows.length) {
      await tx
        .delete(auditLog)
        .where(sql`${auditLog.targetTable} = 'quotes' AND ${auditLog.targetId} = ${QUOTE_ID}`);
    }
    await tx.delete(quotes).where(eq(quotes.id, QUOTE_ID));
  });
  console.log('  DB transaction committed.');

  if (quote.pdfStorageKey && GCS_BUCKET) {
    try {
      const inline = process.env.GCS_CREDENTIALS_JSON;
      const storage = new Storage(inline ? { credentials: JSON.parse(inline) } : {});
      await storage.bucket(GCS_BUCKET).file(quote.pdfStorageKey).delete({ ignoreNotFound: true });
      console.log(`  GCS object deleted: gs://${GCS_BUCKET}/${quote.pdfStorageKey}`);
    } catch (err) {
      console.error(
        `  GCS delete failed (DB rows already gone): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  await pg.end();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error(err);
  await pg.end();
  process.exit(1);
});
