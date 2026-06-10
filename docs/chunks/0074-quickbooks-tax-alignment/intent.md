# QuickBooks Tax Alignment — Intent

**Created:** 2026-06-10

## Problem

The quote → QBO Estimate push ([0073](../closed/0073-quote-estimate-push/plan.md)) ships, but a **live sandbox smoke proved the tax doesn't make it onto the Estimate.** We send tax as a bare `TxnTaxDetail.TotalTax` override + `GlobalTaxCalculation: TaxExcluded`; QBO's **automated sales tax dropped it** and computed $0 because the lines carry no `TaxCodeRef` (non-taxable). Result on Estimate #1001/#145: **Subtotal $400, Taxable subtotal $0.00, Sales tax $0.00, Total $400** — vs the quote's **$452**. (See [`0073 eval addendum`](../closed/0073-quote-estimate-push/eval-2026-06-10-0911.md).)

So today **every pushed Estimate omits tax** — its QBO total is the pre-tax subtotal, understated by the tax amount. That's wrong for a commercial document and blocks trusting the push on real (prod) quotes.

The root cause is architectural, not a bug: you can't hand QBO a tax *number* and expect it honored when automated sales tax is on. QBO computes tax itself from **tax codes** (`TaxCodeRef` on the transaction/lines + the customer's tax setup). To get correct tax, the app has to speak QBO's tax-code language — which means pulling QBO's `TaxCode`/`TaxRate` and mapping our province tax model ([0065](../closed/0065-dealer-province-tax/plan.md)) onto it.

## Desired outcome

- A pushed Estimate shows the **correct tax**, and its **total matches the quote total** (e.g. $452, not $400).
- The app **pulls QBO `TaxCode` (+ rate)** so it knows the connected company's tax codes.
- The Estimate push sets a real **`TaxCodeRef`** (txn- and/or line-level) derived from the quote's province → QBO-tax-code mapping, replacing the dropped `TotalTax` override.
- The app's quote tax and QBO's computed tax are **reconciled** (same rate) so the numbers agree — either by adopting QBO's pulled rate as source of truth, or by validating the 0065 province rate matches QBO's.
- `tax_override` (coach's manual tax) and tax-exempt cases still behave sanely.

## Non-goals

- **Invoices** (Estimate only, per 0073).
- **Full bidirectional tax sync** — only enough to make the Estimate's tax correct + matching.
- **US tax support** beyond what's needed to verify the fetch/API shape (prod is Canadian).
- **Reworking the app's own tax UI / computation** beyond the reconciliation needed for parity.
- **Webhooks / living tax sync** — an on-demand/admin pull, like the item pull.

## Success criteria

- `fetchTaxCodes` / `fetchTaxRates` read QBO's tax entities (paginated, 401→`QboAuthError`, like `fetchItems`).
- A quote on a province with a mapped QBO tax code pushes an Estimate whose **tax line is non-zero and equals the quote's tax**, and whose **total equals the quote total**.
- The mapping fails *closed* with a clear message when a quote's province has no QBO tax code (mirroring 0073's pre-flight discipline — don't push a silently-untaxed Estimate).
- Verified against a **Canadian** QBO company (see the blocker below) — a US-sandbox pass is necessary but **not sufficient**.
- `tsc` + tests green; chunk-end `/eval` PASS.

## Open questions

### ⚠️ Blocker — Canadian vs US tax model (resolve in Phase 1 before building)
The connected sandbox is a **US** company (realm `9341457209207248`, California 8% automated sales tax). Prod/Salesability is **Canadian** (GST/HST/PST per province, realm `193514766730959`). Canadian QBO tax differs from US (txn-level tax code + customer tax code vs US line-level `TAX`/`NON`; AST vs manual tax codes). **The province→QBO-tax-code mapping and the Canadian payload shape cannot be fully built or verified against the US sandbox.** Decide the Phase-1 path:
- **(a)** Create/connect a **Canadian QBO sandbox** (developer portal, CA locale) and build+test against it. *(Preferred if a CA sandbox can be made.)*
- **(b)** Build the generic fetch+map logic, verify the *API shape* against the US sandbox, and **defer Canadian-rate verification** to a CA sandbox / prod.
- **(c)** Inspect the **prod** QBO company's tax setup (AST on/off? manual tax codes? customer default tax codes?) to pin the target shape before coding.
- → **Owner input needed.** This likely makes Phase 1 a research/decision gate, with implementation phases provisional until it's answered.

### Design questions (resolve as Phase 1 surfaces answers)
1. **Txn-level vs line-level `TaxCodeRef`** — which does QBO honor for Canadian GST/HST (a single `TxnTaxDetail.TxnTaxCodeRef`, vs per-line `SalesItemLineDetail.TaxCodeRef`)?
2. **Rate reconciliation** — adopt QBO's pulled rate as source of truth (pull QBO `TaxRate` → drive the app's quote tax), or validate the 0065 province `rate` already matches QBO's? The two must agree or the Estimate total won't match the quote.
3. **AST vs manual tax** — does the prod company use **Automated Sales Tax** (computes from the customer's address and may *ignore* our codes) or manual tax codes? This materially changes the approach.
4. **Customer tax setup** — does the QBO Customer's default tax code / tax-exempt status drive the Estimate's tax (so `dealers` may need a tax-code/exempt link too)?
5. **`quotes.tax_override`** — when QBO computes its own tax, what happens to the coach's manual override? The `TotalTax` override path may need to survive for tax-exempt / manual edge cases.

## Why now

It's the **only remaining piece** of the bidirectional QBO effort (after 0070 dealers / 0071 items / 0073 quotes), and 0073's smoke gave it concrete, reproduced evidence: pushed Estimates are wrong by the tax amount until this ships. Doing it now closes the loop so the quote→Estimate push is trustworthy for real use.

## Relationship to prior work

- **[0073](../closed/0073-quote-estimate-push/plan.md)** — the push this fixes; `mapQuoteToEstimate` is where the `TaxCodeRef` replaces the `TotalTax` override.
- **0065** — the app's province `tax_rates` + `quotes.tax_pct` / `tax_override` tax model this maps onto.
- **[0071](../closed/0071-quickbooks-item-pull/plan.md)** — the read-pull pattern (`fetchItems` → sync) the tax-code pull mirrors.
