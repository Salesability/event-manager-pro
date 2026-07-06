// Pure derivation of a campaign's operational delivery metrics from an accepted
// quote's line items (0094). Stateless: no Date, no DB — the same lines produce
// the same four numbers, so both the accept-time writer
// (`src/features/quotes/*` → `campaigns.{qtyRecords,smsEmail,letters,bdc}`) and
// the one-time backfill script share this single source of truth.
//
// The mapping is keyed off the catalogue SKU codes seeded in
// `drizzle/0013_seed_service_items.sql`. See `docs/chunks/0094-.../decision.md`
// D1 for the rationale. Codes that carry no delivery volume — `additional-day`
// (scheduling), `record-retrieval` (a service), `travel` (dollars) — and any
// unknown code contribute nothing.

/** Records the base-event package bundles. `base-event` "includes 500 records";
 *  `additional-contact` is the per-record uplift above that base. So audience =
 *  500 per base-event unit + each additional-contact line. */
export const BASE_EVENT_RECORDS = 500;

/** The four operational delivery numbers mirrored onto the `campaigns` columns
 *  of the same name. Integers (the columns are `integer`); always all four. */
export type DeliveryMetrics = {
  qtyRecords: number;
  smsEmail: number;
  letters: number;
  bdc: number;
};

/** A quote line reduced to what the mapping needs. `quote_line_items` carries a
 *  snapshotted catalogue `code` + a per-quote `qty`. */
export type DeliveryLine = {
  code: string;
  qty: number;
};

/** A SKU may legitimately appear on multiple lines (rows are delete-and-
 *  reinserted, no `(quote_id, code)` unique), so we SUM `qty` across every
 *  contributing line rather than taking the first match. A quote with no line
 *  for a given metric yields 0 for it — the campaign row deterministically
 *  reflects its accepted quote's scope (D2: all four written unconditionally). */
export function deriveDeliveryMetrics(lines: DeliveryLine[]): DeliveryMetrics {
  const metrics: DeliveryMetrics = { qtyRecords: 0, smsEmail: 0, letters: 0, bdc: 0 };
  for (const line of lines) {
    // Line qty is a validated non-negative integer at the DB (`validatePickedLines`
    // enforces qty ≥ 1); coerce defensively so a malformed value can't poison the
    // sum with NaN.
    const qty = Number.isFinite(line.qty) && line.qty > 0 ? Math.trunc(line.qty) : 0;
    switch (line.code) {
      case 'base-event':
        metrics.qtyRecords += BASE_EVENT_RECORDS * qty;
        break;
      case 'additional-contact':
        metrics.qtyRecords += qty;
        break;
      case 'digital-record':
        metrics.smsEmail += qty;
        break;
      case 'letter-postage':
        metrics.letters += qty;
        break;
      case 'bdc-call':
        metrics.bdc += qty;
        break;
      default:
        // additional-day / record-retrieval / travel / unknown → no delivery metric.
        break;
    }
  }
  return metrics;
}
