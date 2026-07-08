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
  /** Id of that same latest linked quote, so the event surface can link to it
   *  ("Edit Quote" / "View Quote") instead of only offering "Create Quote";
   *  null = no quote yet. Derived from the same row as `quoteStatus`. */
  quoteId: number | null;
  /** The client's MSA standing (active preferred, else pending); null = none. */
  msaStatus: MsaStatus | null;
  /** 0100: this event opts out of the MSA (`campaigns.msa_waived`). When true the
   *  MSA dimension can't leave the event exposed and the surfaces read
   *  "MSA — Not required" instead of the amber nag. Per-event; the quote
   *  dimension is untouched. */
  msaWaived: boolean;
  /** Booked but not yet protected — NOT (accepted quote AND (active MSA OR waived)). */
  exposed: boolean;
};

/** The exposure predicate, pure so callers + tests reason about it DB-free.
 *  A waived event (0100) satisfies the MSA dimension without an active MSA; the
 *  quote dimension is unchanged (an unaccepted quote still exposes). */
export function isExposed(
  quoteStatus: DisplayStatusKey | null,
  msaStatus: MsaStatus | null,
  msaWaived = false,
): boolean {
  return !(quoteStatus === 'accepted' && (msaStatus === 'active' || msaWaived));
}

/** What the calendar / event-detail should show for the MSA dimension of an
 *  event. A waived event (0100) reads as `'waived'` ("MSA — Not required")
 *  regardless of the dealer's actual MSA standing; otherwise it's the dealer's
 *  effective MSA status (active / pending / expired / none). The display layer
 *  (0100 Phase 4) keys the neutral "Not required" pill off `'waived'`. */
export type MsaDisplayState = MsaStatus | 'waived' | null;
export function msaDisplayState(status: {
  msaStatus: MsaStatus | null;
  msaWaived: boolean;
}): MsaDisplayState {
  return status.msaWaived ? 'waived' : status.msaStatus;
}

/** The MSA standing the calendar should show for a dealer — mirrors the accept
 *  gate (`acceptQuote`): an `active` row only counts as active while `expiresAt`
 *  is in the future (the expiry sweep that would flip a stale row to `expired`
 *  isn't built yet, so an `active` row past its expiry must NOT read as
 *  protected). Precedence: valid-active > expired-active > pending > none. */
export function effectiveMsaStatus(
  rows: { status: MsaStatus; expiresAt: Date | null }[],
  nowMs: number = Date.now(),
): MsaStatus | null {
  let sawExpiredActive = false;
  let sawPending = false;
  for (const r of rows) {
    if (r.status === 'active') {
      if (r.expiresAt == null || r.expiresAt.getTime() >= nowMs) return 'active';
      sawExpiredActive = true;
    } else if (r.status === 'pending') {
      sawPending = true;
    }
  }
  if (sawExpiredActive) return 'expired';
  if (sawPending) return 'pending';
  return null;
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
  campaigns: { id: number; dealerId: number; msaWaived: boolean }[],
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

  // MSA per dealer — active (and not past expiry) wins over pending; an
  // active-but-expired row reads as `expired` (= not protected), matching the
  // accept gate. `expiresAt` is required for that check.
  const msaRows = await db
    .select({
      dealerId: masterServiceAgreements.dealerId,
      status: masterServiceAgreements.status,
      expiresAt: masterServiceAgreements.expiresAt,
    })
    .from(masterServiceAgreements)
    .where(
      and(
        inArray(masterServiceAgreements.dealerId, dealerIds),
        inArray(masterServiceAgreements.status, ['active', 'pending']),
      ),
    );
  const rowsByDealer = new Map<number, { status: MsaStatus; expiresAt: Date | null }[]>();
  for (const m of msaRows) {
    const arr = rowsByDealer.get(m.dealerId) ?? [];
    arr.push({ status: m.status, expiresAt: m.expiresAt });
    rowsByDealer.set(m.dealerId, arr);
  }
  const msaByDealer = new Map<number, MsaStatus>();
  for (const [dealerId, rows] of rowsByDealer) {
    const eff = effectiveMsaStatus(rows);
    if (eff) msaByDealer.set(dealerId, eff);
  }

  for (const c of campaigns) {
    const q = latestByCampaign.get(c.id);
    const quoteStatus = q ? quoteDisplayStatus(q) : null;
    const msaStatus = msaByDealer.get(c.dealerId) ?? null;
    out.set(c.id, {
      quoteStatus,
      quoteId: q?.id ?? null,
      msaStatus,
      msaWaived: c.msaWaived,
      exposed: isExposed(quoteStatus, msaStatus, c.msaWaived),
    });
  }
  return out;
}
