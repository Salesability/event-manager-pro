// Chunk 0094 — one-time backfill of campaign delivery metrics from accepted
// quotes (decision.md D3: backfill-all). For every campaign that has an accepted
// quote, overwrite `qty_records / sms_email / letters / bdc` with the numbers
// derived from that quote's line items, and populate `accepted_quote_id`.
//
// Uses the SAME pure mapping as the accept-time writer
// (`src/lib/quotes/delivery-metrics.ts`) so a booking's derived numbers match
// whether they came from an accept or this backfill (single source of truth).
//
// When a campaign has more than one accepted quote (unusual), the
// most-recently-accepted one wins — the same "latest accept overwrites" rule the
// live `acceptQuote` path follows.
//
// Backfill-all (D3): every campaign with an accepted quote is rewritten, even if
// it already had hand-entered numbers — the quote is authoritative. Does NOT
// touch `billing_adjustments` (the Reports override still wins there). Idempotent:
// a committed re-run derives the same numbers → a no-op in effect.
//
// Run (dry-run by default; prints old → new per campaign, writes nothing):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/backfill-campaign-delivery-metrics.ts
//
// Run (dry-run vs PROD — read-only, get the real count first):
//   ./scripts/with-prod-db.sh pnpm dlx tsx scripts/backfill-campaign-delivery-metrics.ts
//
// Apply (COMMIT vs the DATABASE_URL env — one transaction, rolls back on error):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/backfill-campaign-delivery-metrics.ts --write
//   ./scripts/with-prod-db.sh pnpm dlx tsx scripts/backfill-campaign-delivery-metrics.ts --write

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { campaigns, quoteLineItems } from '../src/lib/db/schema';
import { deriveDeliveryMetrics } from '../src/lib/quotes/delivery-metrics';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL (source .env.local, or run via with-prod-db.sh).');
  process.exit(1);
}

const write = process.argv.includes('--write');

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

type Candidate = {
  campaignId: number;
  quoteId: number;
  publicId: string;
  old: { qtyRecords: number | null; smsEmail: number | null; letters: number | null; bdc: number | null; acceptedQuoteId: number | null };
};

async function findCandidates(): Promise<Candidate[]> {
  // One row per campaign that has ≥1 accepted quote, choosing the
  // most-recently-accepted quote as the authority (accepted_at desc, id desc).
  const rows = await db.execute<{
    campaign_id: number;
    quote_id: number;
    public_id: string;
    old_qty: number | null;
    old_sms: number | null;
    old_letters: number | null;
    old_bdc: number | null;
    old_accepted_quote_id: number | null;
  }>(sql`
    SELECT DISTINCT ON (q.campaign_id)
      q.campaign_id::int        AS campaign_id,
      q.id::int                 AS quote_id,
      c.public_id               AS public_id,
      c.qty_records             AS old_qty,
      c.sms_email               AS old_sms,
      c.letters                 AS old_letters,
      c.bdc                     AS old_bdc,
      c.accepted_quote_id::int  AS old_accepted_quote_id
    FROM public.quotes q
    JOIN public.campaigns c ON c.id = q.campaign_id
    -- Only snapshot onto a campaign that belongs to the quote's dealer. A draft
    -- dealer-swap (setQuoteDealer) can leave a stale cross-dealer campaign_id;
    -- matching dealers here mirrors the live writer's cross-dealer guard so the
    -- backfill can't overwrite another dealer's campaign either.
    WHERE q.status = 'accepted' AND q.campaign_id IS NOT NULL AND c.dealer_id = q.dealer_id
    ORDER BY q.campaign_id, q.accepted_at DESC NULLS LAST, q.id DESC
  `);
  return rows.map((r) => ({
    campaignId: r.campaign_id,
    quoteId: r.quote_id,
    publicId: r.public_id,
    old: {
      qtyRecords: r.old_qty,
      smsEmail: r.old_sms,
      letters: r.old_letters,
      bdc: r.old_bdc,
      acceptedQuoteId: r.old_accepted_quote_id,
    },
  }));
}

function changed(
  old: Candidate['old'],
  next: { qtyRecords: number; smsEmail: number; letters: number; bdc: number },
  quoteId: number,
): boolean {
  return (
    old.qtyRecords !== next.qtyRecords ||
    old.smsEmail !== next.smsEmail ||
    old.letters !== next.letters ||
    old.bdc !== next.bdc ||
    old.acceptedQuoteId !== quoteId
  );
}

async function main() {
  try {
    const candidates = await findCandidates();
    console.log(`Campaigns with an accepted quote: ${candidates.length}`);

    const plan: Array<{
      campaignId: number;
      quoteId: number;
      metrics: { qtyRecords: number; smsEmail: number; letters: number; bdc: number };
    }> = [];
    let willChange = 0;

    for (const c of candidates) {
      const lines = await db
        .select({ code: quoteLineItems.code, qty: quoteLineItems.qty })
        .from(quoteLineItems)
        .where(eq(quoteLineItems.quoteId, c.quoteId));
      const m = deriveDeliveryMetrics(lines);
      const diff = changed(c.old, m, c.quoteId);
      if (diff) willChange += 1;
      plan.push({ campaignId: c.campaignId, quoteId: c.quoteId, metrics: m });
      const fmt = (n: number | null) => (n == null ? '·' : String(n));
      console.log(
        `  campaign ${String(c.campaignId).padStart(5)} (${c.publicId}) ← quote ${c.quoteId}  ` +
          `qty ${fmt(c.old.qtyRecords)}→${m.qtyRecords}  sms ${fmt(c.old.smsEmail)}→${m.smsEmail}  ` +
          `let ${fmt(c.old.letters)}→${m.letters}  bdc ${fmt(c.old.bdc)}→${m.bdc}` +
          (diff ? '' : '  (no change)'),
      );
    }

    console.log('');
    console.log(`${willChange} campaign(s) would change; ${candidates.length - willChange} already match.`);

    if (!write) {
      console.log(candidates.length === 0 ? 'Dry-run: no work to do.' : 'Dry-run: re-run with --write to commit.');
      return;
    }
    if (plan.length === 0) {
      console.log('Nothing to apply.');
      return;
    }

    // Single transaction so a partial failure rolls back. No updatedById —
    // system-driven backfill, no attributable actor (the `actors` mixin
    // defaults null when omitted).
    await db.transaction(async (tx) => {
      for (const item of plan) {
        await tx
          .update(campaigns)
          .set({
            qtyRecords: item.metrics.qtyRecords,
            smsEmail: item.metrics.smsEmail,
            letters: item.metrics.letters,
            bdc: item.metrics.bdc,
            acceptedQuoteId: item.quoteId,
          })
          .where(eq(campaigns.id, item.campaignId));
      }
    });

    console.log('');
    console.log(`Applied: ${plan.length} campaign(s) rewritten from their accepted quote.`);
  } finally {
    await pg.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
