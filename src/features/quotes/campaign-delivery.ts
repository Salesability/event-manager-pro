import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campaigns, quoteLineItems, quotes } from '@/lib/db/schema';
import { deriveDeliveryMetrics } from '@/lib/quotes/delivery-metrics';

// Accept either the app pool or a transaction so the integration test can drive
// the snapshot inside a rolled-back tx (cf. calendar-sync.ts / dedup.ts). The
// `acceptQuote` action calls with the default (the app pool).
type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// 0094: snapshot an accepted quote's derived delivery metrics onto its campaign.
//
// The quote is the commercial source of truth for scope; the campaign holds the
// operational delivery numbers (`docs/wiki/commercial-spine.md`). On accept we
// derive `qtyRecords/smsEmail/letters/bdc` from the quote's line items (D1) and
// write them onto the campaign, plus record the campaign→accepted-quote link
// (`campaigns.acceptedQuoteId`, declared since 0093 but written by nothing until
// now). Consumers (Production, event-detail, emails) keep reading the raw
// `campaigns` columns; Reports keeps layering `billing_adjustments` on top.
//
// Not a Server Action (no `'use server'`): it's a server-only mutation called
// downstream of the `acceptQuote` capability gate, same rationale as the
// transition helpers in ./lifecycle.ts. The caller runs it **only on the real
// sent→accepted transition** (inside `acceptQuote`'s `result.transitioned`
// block, alongside the audit + prospect-promotion side effects) so re-accepting
// an *older* accepted quote can't regress a campaign back off its latest quote.
//
// **Cross-dealer guard.** `setQuoteDealer` can swap a draft quote's `dealerId`
// without reconciling its `campaignId`, so a quote's `campaignId` may point at a
// *different* dealer's campaign. The UPDATE is therefore scoped to
// `campaigns.dealerId = quote.dealerId` — a stale cross-dealer link matches 0
// rows (no snapshot) rather than overwriting another dealer's campaign. The root
// (reconcile `campaignId` on dealer-swap) is parked as a 0093/0094 follow-up.
//
// **Latest-accepted-wins guard.** A campaign can carry more than one accepted
// quote (competing revisions). The UPDATE only fires when THIS quote is the
// latest-accepted for the campaign — no other accepted quote is strictly newer
// by `(accepted_at, id)`. Without it, two `sent` quotes accepted at nearly the
// same instant could snapshot out of order and leave the campaign on the older
// one. The subquery reads both timestamps from the DB (no JS Date round-trip),
// so ordering is exact; ties break deterministically on `id`.
export async function applyAcceptedQuoteToCampaign(
  quoteId: number,
  updatedById: string | null = null,
  exec: Executor = db,
): Promise<void> {
  const [quote] = await exec
    .select({ campaignId: quotes.campaignId, dealerId: quotes.dealerId })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  // Legacy pre-0093 quote with no event link — nothing to snapshot onto.
  if (!quote?.campaignId) return;

  const lines = await exec
    .select({ code: quoteLineItems.code, qty: quoteLineItems.qty })
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quoteId));

  const metrics = deriveDeliveryMetrics(lines);

  await exec
    .update(campaigns)
    .set({
      qtyRecords: metrics.qtyRecords,
      smsEmail: metrics.smsEmail,
      letters: metrics.letters,
      bdc: metrics.bdc,
      acceptedQuoteId: quoteId,
      ...(updatedById ? { updatedById } : {}),
    })
    .where(
      and(
        eq(campaigns.id, quote.campaignId),
        eq(campaigns.dealerId, quote.dealerId),
        // Latest-accepted-wins: skip if any OTHER accepted quote for this
        // campaign is strictly newer by (accepted_at, id).
        sql`NOT EXISTS (
          SELECT 1
          FROM ${quotes} newer
          JOIN ${quotes} self ON self.id = ${quoteId}
          WHERE newer.campaign_id = self.campaign_id
            AND newer.status = 'accepted'
            AND (newer.accepted_at > self.accepted_at
                 OR (newer.accepted_at = self.accepted_at AND newer.id > self.id))
        )`,
      ),
    );
}
