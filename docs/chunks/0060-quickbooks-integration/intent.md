# 0060 — QuickBooks Online integration · intent

> **Un-deferred 2026-06-03** (moved out of `future/`). The owner prioritized the import and answered
> Open Decision #1 → **one-time import** (seed prod now; living sync stays a later slice). See
> [`plan.md`](plan.md) for the shippable first slice (Playground-token one-time script, no schema change)
> and [`runbook.md`](runbook.md) for the Intuit-side setup steps.

## Problem

The business already keeps its paying clients in **QuickBooks Online** (the web version). Today those
companies have to be re-entered into this app as `dealers` by hand. We want to connect QBO so that:

1. **(First slice)** existing QBO customers are **imported as `dealers`** (+ their contact people), so the
   app's client list is seeded from the real book of business instead of manual entry.
2. **(Later)** the commercial spine flows back the other way — an accepted **Quote → QBO Estimate/Invoice**,
   so invoicing isn't double-keyed. See [`../../wiki/commercial-spine.md`](../../wiki/commercial-spine.md).

This `intent.md` anchors both, but the **first shippable slice is the import + the OAuth connection** that
everything else depends on.

## Vocabulary bridge (the crux)

QBO's data model calls the company-you-invoice a **`Customer`**. This app calls that a **`dealer`** (the
schema noun for what the business calls a "client" — see [`../../wiki/data-model.md`](../../wiki/data-model.md)
§Dealers). So the import is `QBO Customer → dealers`, and the person on the QBO customer record maps to a
`dealer_contacts(role='staff')` (our point of contact *at* the dealership), **not** `role='customer'` (that
role is reserved for the dealership's own car-buyers, which don't come from QBO).

## Desired outcome

- An admin can connect the app to the business's one QBO company (single OAuth connection).
- Running an import pulls QBO Customers into `dealers`, with their primary contact → `contacts` +
  `contact_identifiers` + `dealer_contacts(role='staff')`.
- Re-running the import is **safe and idempotent** (match-or-create, no duplicates).
- A stable link is kept between each `dealer` and its QBO Customer so future syncs can find the same row.

## Non-goals (first slice)

- Pushing Quotes/Estimates/Invoices *to* QBO — that's the later slice; this one is **read-only** from QBO.
- QBO Payments API / money movement.
- Importing the dealership's own end-customers (car-buyers) — only the QBO Customer *company* + its contact.
- QBO sub-customers / jobs hierarchy (QBO `Job`) — flatten or skip for v1.
- Multi-company / multi-realm support — the app is single-tenant, one QBO company.

## Open decisions (block `plan.md`)

1. **One-time import, or a living sync?** One-time = a script run once (cheap). Ongoing = QBO webhooks +
   CDC polling + conflict handling (meaningfully more work, and drives the external-link table design).
2. **System of record going forward.** If a dealer's name/address differs between QBO and the app, who wins?
   "QBO is truth → overwrite each sync" (simplest) vs "app is truth → import only fills blanks" (won't
   clobber edits made here).

## Already settled (during the 2026-05-29 research)

- **Auth is OAuth 2.0 (authorization-code grant) + OIDC** via developer.intuit.com — no API-key option.
- **Single-tenant simplifies everything:** one connection record, not a per-user token table.
- The OAuth **callback is a route handler** (external caller); the **import + connect-initiation are Server
  Actions** (our own UI), per repo conventions.
- A **schema gap exists**: `dealers` has no external-id column. Recommended fix is a small
  `external_account_links` table — see `research.md`.

Full technical detail (flow, endpoints, token lifetimes, field mapping, schema options, SDKs) lives in
[`research.md`](research.md).

## Success criteria (first slice)

- [ ] Admin connects QBO once; tokens stored encrypted; connection survives token refresh + rotation.
- [ ] Import maps QBO Customer → `dealers` (+ contact) per the field table in `research.md`.
- [ ] Re-import is idempotent (external-link match + `contact_identifiers` dedup boundary).
- [ ] No schema change ships without going through the `db-conventions` skill.
