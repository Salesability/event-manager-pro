import 'server-only';
import { and, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { masterServiceAgreements, quotes } from '@/lib/db/schema';
import type { DisplayStatusKey } from '@/features/quotes/status-display';
import type { QuoteStatus } from '@/features/quotes/queries';
import type { MsaStatus } from '@/features/msa/queries';

// 0093: per-event commercial status for the calendar. An event (campaign) is
// "commercially protected" only when its quote is **accepted** AND the client
// has an **active** MSA — the cancellation fee (MSA §2iii) needs both. Anything
// less is "exposed": a booked date with no enforceable commitment. The calendar
// flags exposed events so the upfront work doesn't get missed.

const MS_PER_DAY = 86_400_000;

export type CommercialStatus = {
  /** Display status of the event's latest linked quote; null = no quote yet. */
  quoteStatus: DisplayStatusKey | null;
  /** The client's MSA standing (active preferred, else pending); null = none. */
  msaStatus: MsaStatus | null;
  /** Booked but not yet protected — NOT (accepted quote AND active MSA). */
  exposed: boolean;
};

/** The exposure predicate, pure so callers + tests reason about it DB-free. */
export function isExposed(
  quoteStatus: DisplayStatusKey | null,
  msaStatus: MsaStatus | null,
): boolean {
  return !(quoteStatus === 'accepted' && msaStatus === 'active');
}

/** Derived quote display status — mirrors `features/quotes/queries.ts:127`: an
 *  expired `sent` quote paints `expired` (the row itself stays `sent`). */
export function quoteDisplayStatus(q: {
  status: QuoteStatus;
  sentAt: Date | null;
  quoteValidDays: number;
}): DisplayStatusKey {
  if (
    q.status === 'sent' &&
    q.sentAt != null &&
    q.sentAt.getTime() + q.quoteValidDays * MS_PER_DAY < Date.now()
  ) {
    return 'expired';
  }
  return q.status;
}

/**
 * Resolve per-event quote status + per-client MSA status (+ the exposed flag)
 * for a batch of campaigns in two queries — no N+1 across the calendar.
 * The quote is the campaign's latest linked quote (highest id); the MSA is the
 * dealer's active-or-pending standing.
 */
export async function loadCommercialStatusByCampaign(
  campaigns: { id: number; dealerId: number }[],
): Promise<Map<number, CommercialStatus>> {
  const out = new Map<number, CommercialStatus>();
  if (campaigns.length === 0) return out;

  const campaignIds = campaigns.map((c) => c.id);
  const dealerIds = [...new Set(campaigns.map((c) => c.dealerId))];

  // Latest linked quote per campaign (highest id wins).
  const quoteRows = await db
    .select({
      id: quotes.id,
      campaignId: quotes.campaignId,
      status: quotes.status,
      sentAt: quotes.sentAt,
      quoteValidDays: quotes.quoteValidDays,
    })
    .from(quotes)
    .where(inArray(quotes.campaignId, campaignIds));

  const latestByCampaign = new Map<number, (typeof quoteRows)[number]>();
  for (const q of quoteRows) {
    if (q.campaignId == null) continue;
    const cur = latestByCampaign.get(q.campaignId);
    if (!cur || q.id > cur.id) latestByCampaign.set(q.campaignId, q);
  }

  // MSA per dealer: active wins over pending; everything else is "no MSA".
  const msaRows = await db
    .select({
      dealerId: masterServiceAgreements.dealerId,
      status: masterServiceAgreements.status,
    })
    .from(masterServiceAgreements)
    .where(
      and(
        inArray(masterServiceAgreements.dealerId, dealerIds),
        inArray(masterServiceAgreements.status, ['active', 'pending']),
      ),
    );
  const msaByDealer = new Map<number, MsaStatus>();
  for (const m of msaRows) {
    if (m.status === 'active') {
      msaByDealer.set(m.dealerId, 'active');
    } else if (msaByDealer.get(m.dealerId) !== 'active') {
      msaByDealer.set(m.dealerId, 'pending');
    }
  }

  for (const c of campaigns) {
    const q = latestByCampaign.get(c.id);
    const quoteStatus = q ? quoteDisplayStatus(q) : null;
    const msaStatus = msaByDealer.get(c.dealerId) ?? null;
    out.set(c.id, { quoteStatus, msaStatus, exposed: isExposed(quoteStatus, msaStatus) });
  }
  return out;
}
