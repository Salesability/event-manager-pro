import type { CommercialStatus } from './commercial-status';

// 0104: the event-detail dialog is the commercial-workflow hub, so it emphasizes
// the single NEXT action in the funnel — Book Event → Create Quote → Send MSA →
// Mark Accepted → Protected. This is a pure selector over the already-computed
// `CommercialStatus` (no new status logic, no DB); the dialog uses it to pick
// which existing CTA renders as the primary (brand) button. Kept in its own
// (non-`server-only`) module so the client dialog AND unit tests can import it.

export type NextCommercialStep =
  | 'create-quote' // no quote yet
  | 'edit-quote' // a draft quote exists — finish + send it
  | 'send-msa' // quote is out but the client has no active/waived MSA
  | 'accept-quote' // MSA is in place + a sent quote is waiting to be accepted
  | null; // protected, cancelled, or no unambiguous next step

/**
 * Which funnel step the event dialog should surface as the primary action.
 * Precedence follows the funnel order and the accept gate (an accept needs an
 * active-or-waived MSA), so `send-msa` outranks `accept-quote` when both are
 * open. Returns `null` when the event is protected (nothing left), cancelled,
 * or in a state with no single obvious next step (e.g. a declined/expired quote
 * once the MSA is already in place — the coach decides what to do next).
 */
export function nextCommercialStep(
  campaignStatus: 'draft' | 'booked' | 'cancelled' | 'completed',
  commercial: CommercialStatus | undefined,
): NextCommercialStep {
  if (campaignStatus === 'cancelled' || !commercial) return null;
  // Not exposed = accepted quote AND (active MSA OR waived) — fully protected.
  if (!commercial.exposed) return null;

  const msaOk = commercial.msaStatus === 'active' || commercial.msaWaived;

  // 1) Get a quote in place.
  if (commercial.quoteId == null) return 'create-quote';
  if (commercial.quoteStatus === 'draft') return 'edit-quote';

  // 2) A quote is out (sent/accepted/declined/expired). The MSA must be in
  //    place before the quote can be accepted, so it's the next step when missing.
  if (!msaOk) return 'send-msa';

  // 3) MSA is satisfied; a still-open sent quote just needs accepting.
  if (commercial.quoteStatus === 'sent') return 'accept-quote';

  // Declined/expired quote with the MSA already in place — no single obvious
  // next step from the dialog; the exposure banner still flags it.
  return null;
}
