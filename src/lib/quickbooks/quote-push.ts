import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { quotes } from '@/lib/db/schema';
import { effectiveUnit } from '@/lib/quotes/pricing';
import {
  type QboEstimateInput,
  type QboEstimateLine,
  createEstimate,
  fetchEstimateById,
  updateEstimate,
} from '@/lib/quickbooks/client';

// Push a quote TO QuickBooks as an Estimate (chunk 0073 — Slice 3 of the
// bidirectional effort). The app→QBO counterpart pattern of dealer-push.ts:
// linked quote (quickbooks_estimate_id set) → UPDATE the Estimate with a
// freshly-read SyncToken; unlinked → CREATE one and backfill the returned Id.
// An Estimate needs a CustomerRef (the dealer's quickbooks_id, 0070) and every
// line needs an ItemRef (the SKU's service_items.quickbooks_id, 0071), so a
// pre-flight readiness check fails closed when anything is unlinked. Tax is
// pushed as the quote's already-computed amount (TxnTaxDetail.TotalTax +
// GlobalTaxCalculation=TaxExcluded) so the Estimate total equals the quote.

type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export class QuotePushNotReadyError extends Error {}

// Inputs are DB-free so the pure functions are unit-testable. The Server Action
// resolves each line's `itemQuickbooksId` from `service_items` before calling.
export type QuotePushDealer = { id: number; name: string; quickbooksId: string | null };
export type QuotePushLine = {
  code: string;
  label: string;
  qty: number;
  unitPrice: string;
  overrideUnitPrice: string | null;
  lineTotal: string;
  itemQuickbooksId: string | null; // service_items.quickbooks_id (null = unlinked / no SKU)
};
export type QuotePushQuote = {
  id: number;
  quickbooksEstimateId: string | null;
  subtotal: string; // pre-tax subtotal (numeric string)
  tax: string; // the quote's computed tax (numeric string)
  // QBO tax code for the quote's province (0074) — `tax_rates.quickbooks_tax_code_id`
  // for the dealer's province. Drives `TxnTaxDetail.TxnTaxCodeRef` so QBO computes
  // the tax. Null when the province isn't mapped → push fails the pre-flight.
  taxCodeId: string | null;
  // The province's CURRENT rate (`tax_rates.rate`, %), which equals the matched
  // QBO code's rate (the matcher links by rate). Used to detect rate drift: the
  // quote's `tax` was computed from a SNAPSHOT rate at save time, so if the rate
  // changed since, QBO (current rate) and the quote would disagree. Null = unmapped.
  provinceRatePct: string | null;
  // Coach's manual tax override (0065), or null. Can't be faithfully represented
  // as a QBO tax code yet → pushing an overridden quote fails the pre-flight (v1).
  taxOverride: string | null;
};

// Pure: does the quote's tax equal what QBO will compute (subtotal × rate)?
// Tolerates a cent of rounding. Used to catch a province-rate change between
// quote-save (snapshot) and push (QBO uses the current rate).
export function quoteTaxMatchesRate(subtotal: number, tax: number, ratePct: number): boolean {
  const expected = Math.round(subtotal * ratePct) / 100; // = roundCents(subtotal × ratePct/100)
  return Math.abs(expected - tax) <= 0.01;
}

export type QuotePushReadiness = { ok: true } | { ok: false; reason: string };

// Pure pre-flight: the dealer must be QBO-linked, every line SKU must be
// QBO-linked, and (if the quote is taxed) its province must map to a QBO tax
// code — else there's no CustomerRef / ItemRef / TxnTaxCodeRef to build a valid,
// correctly-taxed Estimate.
export function checkQuotePushReadiness(
  quote: QuotePushQuote,
  dealer: QuotePushDealer,
  lines: QuotePushLine[],
): QuotePushReadiness {
  if (!dealer.quickbooksId) {
    return {
      ok: false,
      reason: `Dealer "${dealer.name}" isn't linked to QuickBooks yet — run Sync dealers first.`,
    };
  }
  if (lines.length === 0) {
    return { ok: false, reason: 'This quote has no line items to push.' };
  }
  const unlinked = lines.filter((l) => !l.itemQuickbooksId).map((l) => l.code);
  if (unlinked.length > 0) {
    return {
      ok: false,
      reason: `These items aren't linked to QuickBooks yet — run Pull items first: ${unlinked.join(', ')}.`,
    };
  }
  // Tax (0074): a manual override can't be represented as a QBO tax code yet;
  // a taxed quote needs its province mapped (QBO computes from the code).
  if (quote.taxOverride != null) {
    return {
      ok: false,
      reason:
        "This quote has a manual tax override, which can't be pushed to QuickBooks yet — remove the override or push without it.",
    };
  }
  if (Number(quote.tax) > 0 && !quote.taxCodeId) {
    return {
      ok: false,
      reason:
        "This quote's province isn't mapped to a QuickBooks tax code — run Pull tax codes first.",
    };
  }
  // Rate-drift guard: the quote's tax was snapshotted at save time; QBO will
  // compute from the province's CURRENT rate. If they disagree, the Estimate
  // total wouldn't match the quote — fail closed rather than push a mismatch.
  if (
    Number(quote.tax) > 0 &&
    quote.provinceRatePct != null &&
    !quoteTaxMatchesRate(Number(quote.subtotal), Number(quote.tax), Number(quote.provinceRatePct))
  ) {
    const expected = (Math.round(Number(quote.subtotal) * Number(quote.provinceRatePct)) / 100).toFixed(2);
    return {
      ok: false,
      reason: `This quote's tax ($${quote.tax}) no longer matches QuickBooks' rate (${quote.provinceRatePct}% → $${expected}) — the province rate changed since the quote was created. Re-create the quote to push it.`,
    };
  }
  return { ok: true };
}

// Pure: quote + lines + dealer → QBO Estimate write payload. Assumes the
// readiness check passed (dealer + every line linked).
export function mapQuoteToEstimate(
  quote: QuotePushQuote,
  lines: QuotePushLine[],
  dealer: QuotePushDealer,
): QboEstimateInput {
  if (!dealer.quickbooksId) throw new Error('mapQuoteToEstimate: dealer not linked (pre-flight not run).');

  const estimateLines: QboEstimateLine[] = lines.map((l) => {
    if (!l.itemQuickbooksId) {
      throw new Error(`mapQuoteToEstimate: line "${l.code}" not linked (pre-flight not run).`);
    }
    const unit = effectiveUnit({
      unitPrice: Number(l.unitPrice),
      overrideUnitPrice: l.overrideUnitPrice != null ? Number(l.overrideUnitPrice) : undefined,
    });
    // Derive Amount from the (2-decimal) unit × qty rather than the stored
    // `lineTotal`, so the line is self-consistent for QBO (which validates
    // Amount == Qty × UnitPrice). They're equal in the normal case; they can
    // differ by a cent only when a price was entered with >2 decimals (the
    // numeric(10,2) column rounds `unit` but `lineTotal` was computed pre-round)
    // — and a self-consistent line keeps QBO from rejecting/recomputing it.
    const amount = Math.round(unit * l.qty * 100) / 100;
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      Description: l.label,
      SalesItemLineDetail: { ItemRef: { value: l.itemQuickbooksId }, Qty: l.qty, UnitPrice: unit },
    };
  });

  // Tax (0074): set the province's QBO tax code so QBO computes the tax itself
  // (a bare `TotalTax` override is dropped by QBO — see the 0073 smoke). Omitted
  // when the quote isn't taxed. The pre-flight guarantees a code is present when
  // tax > 0, so this matches the quote's tax as long as the rates are aligned.
  const taxed = Number(quote.tax) > 0 && quote.taxCodeId != null;
  return {
    CustomerRef: { value: dealer.quickbooksId },
    Line: estimateLines,
    ...(taxed ? { TxnTaxDetail: { TxnTaxCodeRef: { value: quote.taxCodeId as string } } } : {}),
  };
}

export type QuotePushResult = { action: 'created' | 'updated'; estimateId: string };

// Push the quote. Pre-flight → throw QuotePushNotReadyError on an unlinked
// dealer/SKU (a user-actionable state). Linked → read-before-write SyncToken +
// updateEstimate; unlinked → createEstimate → guarded backfill of
// quickbooks_estimate_id (a concurrent push that already linked loses the race
// gracefully — the freshly-created Estimate is an accepted rare duplicate).
export async function pushQuoteToQuickbooks(
  quote: QuotePushQuote,
  lines: QuotePushLine[],
  dealer: QuotePushDealer,
  realmId: string,
  accessToken: string,
  exec: Executor = db,
): Promise<QuotePushResult> {
  const ready = checkQuotePushReadiness(quote, dealer, lines);
  if (!ready.ok) throw new QuotePushNotReadyError(ready.reason);

  const payload = mapQuoteToEstimate(quote, lines, dealer);

  if (quote.quickbooksEstimateId) {
    const current = await fetchEstimateById(realmId, accessToken, quote.quickbooksEstimateId);
    await updateEstimate(realmId, accessToken, {
      ...payload,
      Id: quote.quickbooksEstimateId,
      SyncToken: current.SyncToken ?? '0',
    });
    return { action: 'updated', estimateId: quote.quickbooksEstimateId };
  }

  const created = await createEstimate(realmId, accessToken, payload);
  await exec
    .update(quotes)
    .set({ quickbooksEstimateId: created.Id })
    .where(and(eq(quotes.id, quote.id), isNull(quotes.quickbooksEstimateId)))
    .returning({ id: quotes.id });
  return { action: 'created', estimateId: created.Id };
}
