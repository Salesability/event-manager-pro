# Editable Report Tab for Billing — Intent

**Created:** 2026-05-21

## Problem

The Report tab (`src/app/(app)/reports/page.tsx` → `src/features/reports/reports-tabs.tsx`) shows four **read-only** views — By Dealer, By Coach, By Month, and a Full Production Report — all rendered as `<DataTable>`s over **server-computed aggregates** (`loadCampaignsByDealer`, `loadCampaignsByMonth`, `loadFullProductionReport`, etc.). When the owner generates invoices, they sometimes need to **adjust figures for billing purposes** (e.g. a corrected record count or a one-off billing quantity) — but today every value is derived and there's nowhere to make that adjustment. The owner flagged this as a **"nice to have."**

## Desired outcome

On the report (most likely the Full Production Report tab), the owner can edit the billing-relevant figures inline, the adjusted values persist, and the totals reflect them — so the numbers used to generate an invoice match what the owner intends to bill, without mutating the underlying campaign source-of-truth in a confusing way.

## Non-goals

- **No invoicing engine.** This is about adjusting report figures, not generating/sending invoices (that's the larger 0025 quote-to-payment epic).
- **No editing of the derived aggregate tabs** (By Dealer/Coach/Month) directly — those stay computed; edits happen at the row/campaign grain.
- **No silent overwrite of source data.** A billing adjustment should be distinguishable from the campaign's actual recorded values.

## Success criteria

- Billing-relevant cells on the report are editable inline (mirroring the quote-composer's per-line override input pattern).
- Edits persist and survive reload.
- Report totals reflect the adjusted (billing) values.
- The original computed value remains recoverable (an adjustment, not a destructive edit).

## Open questions

- **Persistence model (the load-bearing decision).** Where do billing adjustments live? Options: (a) new nullable `billing_*` override columns on `campaigns`; (b) a dedicated `billing_adjustments` table keyed by campaign; (c) reuse/extend the quote layer. This is a data-model decision to settle before any UI — needs the `db-conventions` skill. (Leaning (b) — keeps billing concerns off the campaign row.)
- **Which figures are editable?** Records / SMS / letters quantities? A dollar amount? The owner should name the exact fields they adjust at invoice time.
- **Which tab?** Full Production Report (row grain) is the natural home; the aggregate tabs would then recompute from adjusted rows. Confirm.
- **Permissions.** Admin-only, or coaches too? Reports are currently `requireRole(['admin','coach'])`.

## Why now

The owner does this adjustment manually today (outside the app) when invoicing, and asked for it in-app — but tagged it a "nice to have," so it ranks below the booking, document, and travel-label items. Captured now so the data-model decision can be made deliberately rather than under invoicing-deadline pressure; pairs naturally with the 0025 quote-to-payment epic's eventual invoice surface.
