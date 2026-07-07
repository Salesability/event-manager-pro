// Pure model for the third-party "production feed" (0097) — the read-only view of
// the Production List that an external implementer's Google Sheet pulls via
// `=IMPORTDATA()`. Stateless: no DB, no Date (the caller passes `todayIso`), so the
// same campaigns + day produce the same rows. The route handler
// (`src/app/api/production-feed/route.ts`) composes these with `buildCsv`.
//
// Two deliberate narrowings vs. the internal `/production` list + CSV export:
//  1. ROWS — only booked/upcoming work: `status ∈ {booked, completed}` AND the run
//     hasn't fully passed (`endDate >= today`). Draft, cancelled, and fully-past
//     campaigns never reach an outside vendor.
//  2. COLUMNS — delivery-focused. The vendor sees dates, dealer + location,
//     format, coach, the four delivery volumes (their workload), the dealer's
//     PRIMARY contact (name/phone/email — who to call at the rooftop, 0098), and
//     the campaign `notes` (0098, owner-requested — un-redacted). It does NOT see
//     the campaign's OWN booking contact (`contact`/`phone`/`email`), the
//     audience/data source, or status/ops internals. Mirrors the calendar
//     projection's "customer-safe subset" discipline
//     (`src/lib/google/calendar-event.ts`), narrowed to the implementer's set.

import type { Campaign } from './queries';

/** Column order of the feed CSV. The Google Sheet keys off these headers, so the
 *  set + order is a contract — additive changes only, and never add a PII/notes
 *  column here (see the redaction rationale above). */
export const FEED_HEADERS = [
  'Start Date',
  'End Date',
  'Dealer',
  'Location',
  'Format',
  'Coach',
  'Records',
  'SMS-Email',
  'Letters',
  'BDC',
  'Contact',
  'Contact Phone',
  'Contact Email',
  'Notes',
] as const;

/** The dealer's resolved primary contact for one row (0098), from
 *  `loadDealerPrimaryContacts`. Absent when the dealer has no non-archived
 *  contact — the mapper then emits blanks. */
export type FeedDealerContact = { name: string; phone: string | null; email: string | null };

/** Booked + upcoming only. `booked`/`completed` are the "real work" statuses
 *  (draft = not committed, cancelled = called off); `endDate >= todayIso` drops
 *  fully-past runs. ISO `YYYY-MM-DD` strings compare lexically = chronologically. */
export function selectFeedCampaigns(campaigns: Campaign[], todayIso: string): Campaign[] {
  return campaigns.filter(
    (c) => (c.status === 'booked' || c.status === 'completed') && c.endDate >= todayIso,
  );
}

/** One CSV row in `FEED_HEADERS` order. Null → empty cell. The safe subset is
 *  read off the campaign PLUS the dealer's primary `contact` (0098) and the
 *  campaign `notes` (0098). The campaign's OWN booking `contact`/`phone`/`email`
 *  and the audience/data source are intentionally never touched here. */
export function mapCampaignToFeedRow(c: Campaign, contact?: FeedDealerContact): string[] {
  const num = (n: number | null) => (n == null ? '' : String(n));
  return [
    c.startDate,
    c.endDate,
    c.dealerName,
    c.dealerAddress ?? '',
    c.styleLabel ?? '',
    c.coachName ?? '',
    num(c.qtyRecords),
    num(c.smsEmail),
    num(c.letters),
    num(c.bdc),
    contact?.name ?? '',
    contact?.phone ?? '',
    contact?.email ?? '',
    c.notes ?? '',
  ];
}
