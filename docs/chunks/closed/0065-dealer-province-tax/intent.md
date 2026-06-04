# Canadian sales tax by dealer province — Intent

**Created:** 2026-06-04

## Problem

Quote tax is a **manually-typed dollar amount** ("Tax ($)" in the composer → `quotes.tax`). It's error-prone and inconsistent across Canada's province-specific sales-tax rates (GST / HST / PST / QST all differ by province). There is no province on the dealer, no rate logic anywhere, and the `quotes.tax_pct` column is dead schema cargo (default 15%, never read or written). The business bills Canadian dealers across multiple provinces, each with a different combined rate — so a coach has to know and hand-enter the right tax on every quote.

## Desired outcome

When a coach builds a quote for a dealer, the tax **auto-computes from the dealer's province** — `subtotal × province rate` — using an admin-maintained rate table, with the applied province + rate visible on the composer and the PDF. A coach can still **override** the dollar amount for edge cases (e.g. a tax-exempt dealer). Admins edit the province→rate table in `/admin/lookups`, and it ships **seeded with the current (June 2026) combined rates**. Existing quotes are untouched.

## Non-goals

- **Itemized GST vs PST/QST** as separate lines on the quote/PDF — one combined "Tax" line for now (matches today's single tax line). Quebec/BC/SK/MB split-tax is a separate, larger change.
- **A structured tax-exempt flag** — the manual override covers exemptions in v1.
- **US / international tax** — Canadian provincial sales tax only.
- **Event-location-based tax** — we bill the **dealer's** province (place-of-supply for services), not the event's location.
- **Per-line-item tax categories** (zero-rated / exempt SKUs) — every line is taxed at the single province rate.

## Success criteria

- Dealers have a structured **`province`** (the 13 CA provinces/territories); the dealer form has a province dropdown.
- An **admin-editable province→rate table** exists in `/admin/lookups`, **seeded** with the June-2026 combined rates (AB 5.000 · BC 12.000 · MB 12.000 · NB 15.000 · NL 15.000 · NT 5.000 · NS 14.000 · NU 5.000 · ON 13.000 · PE 15.000 · QC 14.975 · SK 11.000 · YT 5.000).
- A quote's tax **auto-fills** from `dealer province → rate × subtotal`, snapshotting the applied rate onto the quote; the **override** path still works.
- The composer and PDF show the **applied province + rate**.
- Existing quotes are unchanged (their stored tax is preserved).

## Open questions

- **Backfill of dealer provinces:** existing dealers have only a freeform address — set `province` NULL and let admins fill it in, or attempt a one-time best-effort parse from the address string? *(Lean: NULL + admin fills; optionally a one-shot best-effort parse as a convenience, never trusted for billing.)*
- **Missing province at quote time:** when a quote's dealer has no province, block / fall back to $0 tax + a visible warning / require the manual override? *(Lean: $0 + a "set the dealer's province" warning, override available.)*
- **Override semantics:** a nullable `tax_override` column (blank = auto) vs a boolean flag — and whether editing lines after an override re-applies the override or recomputes. *(Lean: nullable `tax_override`; auto unless the override is set.)*
- **Precision:** the rate column must be `numeric(6,3)` to hold QC's 14.975%; `quotes.tax_pct` must be widened from `(5,2)` to `(6,3)` too.

## Why now

The first production deploy just went live — real quotes are about to go out to real Canadian dealers. Hand-typing tax per quote is a billing-accuracy risk; getting province-correct tax in before quote volume grows avoids having to reissue mis-taxed quotes.
