-- 0065 follow-up — undo the over-broad 0028 tax_override backfill on DRAFT quotes.
--
-- Migration 0028 ran `UPDATE quotes SET tax_override = tax` against every
-- pre-existing quote. Those quotes predated the province tax model, so their
-- `tax` was 0 — which pinned each one to a $0.00 *manual* override. A non-NULL
-- override unconditionally beats the dealer's province rate
-- (computePickedTotals: `override != null ? override : subtotal * rate`), so
-- these quotes can never auto-tax: their PDF renders "Tax $0.00" no matter the
-- dealer's province.
--
-- That lock is correct for *issued* quotes (sent / accepted / declined) — we
-- don't silently re-tax a quote a dealer already saw. But DRAFTS are not issued
-- and should reflect the dealer's current province rate. So for drafts that
-- still carry an override: clear it and re-derive tax_pct / tax / total from the
-- dealer's province (NULL province → rate 0 → $0, matching the live composer
-- and `dealerTaxRatePct`). ROUND(x, 2) matches the app's `roundCents` for the
-- non-negative tax amounts here.
--
-- Caveat: any *intentional* manual override a coach set on a draft after 0065
-- is also reset to auto. None are expected (pre-launch), and a draft is trivial
-- to re-edit if so.
UPDATE "quotes" AS q
SET "tax_pct"      = COALESCE(tr."rate", 0),
    "tax"          = ROUND(q."subtotal" * COALESCE(tr."rate", 0) / 100.0, 2),
    "total"        = q."subtotal" + ROUND(q."subtotal" * COALESCE(tr."rate", 0) / 100.0, 2),
    "tax_override" = NULL
FROM "dealers" d
LEFT JOIN "tax_rates" tr ON tr."province" = d."province"
WHERE q."dealer_id" = d."id"
  AND q."status" = 'draft'
  AND q."tax_override" IS NOT NULL;
