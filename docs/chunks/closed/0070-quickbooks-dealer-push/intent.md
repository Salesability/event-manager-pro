# QuickBooks Dealer Push (app → QBO Customers) — Intent

**Created:** 2026-06-09

## Problem

Chunk [0069](../0069-quickbooks-dealer-sync/plan.md) made the QuickBooks link **one-directional**: QBO Customers flow *into* our `dealers` table (create / link / backfill `quickbooks_id`), but nothing flows *back*. A dealer created or edited in-app — a new prospect from the "Book Your Event" funnel, a corrected address, a fixed company name — never reaches QuickBooks. The owner has to re-key it in QBO by hand, and the two systems drift.

This is **Slice 1 of a larger bidirectional effort** (see *Follow-on slices*). It closes the dealer half of the loop: the same `dealers.quickbooks_id` 0069 introduced becomes the handle for *writing* a dealer back to QBO, not just *reading* one in.

## Desired outcome

- An admin viewing a dealer at `/dealerships/[id]` sees the dealer's **QuickBooks link state** (linked to QB customer #N, or not in QuickBooks yet) and an explicit **"Push to QuickBooks"** button.
- Clicking it, **on demand** (never auto-on-save):
  - **Linked dealer** (has `quickbooks_id`) → **updates** the existing QBO Customer with our current `name` / `address` / `province` (+ primary contact email/phone).
  - **Unlinked dealer** → **creates** a new QBO Customer, then **backfills** the returned `Customer.Id` onto `dealers.quickbooks_id` (closing the loop both ways — this is also how the 137 dealers the 0060 import seeded get a real QB identity once pushed).
- The QBO **`SyncToken` optimistic-lock** is handled correctly so updates don't 400 on a stale token.
- The push runs through a **Server Action** (repo convention — mutations are Server Actions, not route handlers), admin-gated via `assertCan('admin:access')`, registered in the action-gate matrix.
- After the push the dealer page re-renders to the new link state and flashes a summary (created / updated).

## Non-goals

Deferred to **later slices** of the bidirectional effort (capture, don't build here):

- **Quotes → QBO Estimates** (Slice 3) — pushing an accepted quote back as a QBO `Estimate`. Needs this slice's `CustomerRef` link plus Slice 2's item links.
- **One-way item pull** (Slice 2) — QBO `Item`s → our `service_items` catalog + a `service_items.quickbooks_id` link, so quote lines can carry an `ItemRef`. Pull-only into the app (owner's call: items are not create-from-app).
- **Tax-rate alignment pull** — sync QBO tax codes/rates *into* the app so a quote's computed tax matches what QBO would compute. QBO→app direction; its own slice.
- **Webhooks / CDC / living two-way sync** — this stays admin-triggered and on-demand, not a subscription.
- **Auto-push on dealer save** — the push is an explicit button, never a side effect of `createDealer`/`updateDealer`.
- **Non-dealer skip-list** (still parked from 0069) — excluding vendors / Salesability-itself from sync. Relevant once a *prod* QB connection is enabled; not this sandbox slice.
- **Batch "push all dealers"** — single-dealer push only for v1 (note a batch entry point as a possible follow-up).

## Success criteria

- `src/lib/quickbooks/client.ts` gains `createCustomer` / `updateCustomer` (+ a `fetchCustomerById` for the SyncToken read) using the existing `com.intuit.quickbooks.accounting` scope — no re-consent.
- Pushing an **unlinked** dealer creates a QBO Customer and stamps its `Id` onto `dealers.quickbooks_id` (guarded `UPDATE … WHERE id=? AND quickbooks_id IS NULL`, mirroring 0069's link guard — never clobbers an existing link).
- Pushing a **linked** dealer updates the existing QBO Customer with a **fresh SyncToken** (no stale-token 400).
- Re-pushing an unchanged linked dealer is safe (idempotent enough: an update with current data is a harmless no-op write).
- The push is a Server Action, admin-gated, registered in `action-gate-matrix.ts`; the button renders on `/dealerships/[id]` only when a QB connection exists.
- `tsc` + tests green (unit: `mapDealerToCustomer` inverse map + create/update decision; integration: the create-then-backfill write in a rolled-back tx with QBO mocked); chunk-end `/eval` PASS; browser smoke shows the link-state + "Push to QuickBooks" control on a fixture dealer's detail page.
- Sandbox-only this slice; the column/wiring already exist on prod, but a prod push is gated on the still-owner-pending Intuit **Production** redirect URI + production-API approval.

## Open questions

- **SyncToken strategy.** QBO rotates `SyncToken` on *every* write — including edits made directly in the QBO UI. Leaning **read-before-write** (re-fetch the Customer by `Id` immediately before the update to grab the current token) over storing a `sync_token` column on `dealers`, because a stored token goes stale the moment someone edits in QBO. Read-before-write is stateless and always fresh, at the cost of one extra GET per update. **Default: read-before-write; no schema change.** Confirm.
- **`DisplayName` uniqueness on create.** QBO requires `Customer.DisplayName` to be unique across the company; a create whose name collides with an existing QBO customer returns duplicate error **6240**. How to surface — friendly "already exists in QuickBooks, link instead" message? (The 0069 *sync* is the linking path; a future "link to existing QB customer" affordance may belong here.)
- **Address fidelity.** Our `dealers.address` is a single flat text blob (0069's `formatAddress` joined Line1/City/province/postal into one string). QBO's `BillAddr` is structured (`Line1` / `City` / `CountrySubDivisionCode` / `PostalCode`). Reversing the blob is lossy. **Default: send the whole string as `BillAddr.Line1` + `province` → `CountrySubDivisionCode`**; don't attempt to re-parse. Acceptable for v1?
- **Email/phone source.** `dealers` has no email/phone columns — they live on the primary `contact` (the dealer detail page reads `dealer.primaryEmail`/`primaryPhone` via `loadDealer`'s join). Include them in the pushed Customer (`PrimaryEmailAddr` / `PrimaryPhone`) from the primary contact? **Default: yes, when present.**

## Why now

Prod just took 0068 + 0069 (rev `event-manager-pro-00010-759`, prod DB at migration `0032`); the OAuth plumbing, token store, refresh lifecycle, and the `dealers.quickbooks_id` link are warm and proven. The owner asked for **bidirectional** sync; this is the smallest self-contained slice that delivers real two-way value (dealer edits reach QBO) and is the **prerequisite for pushing Estimates** (a quote's `CustomerRef` is exactly a linked dealer's `quickbooks_id`). Doing it first de-risks the larger effort.

## Follow-on slices (context, not in scope here)

1. **This chunk — Slice 1:** Dealers → QBO Customers push.
2. **Slice 2:** One-way item pull (QBO `Item` → `service_items` + `quickbooks_id`), so quote lines carry an `ItemRef`.
3. **Slice 3:** Quotes → QBO **Estimates** push (on-demand "Push to QuickBooks" on a quote), using this slice's `CustomerRef` + Slice 2's `ItemRef` + the aligned tax.
4. **Tax-alignment pull:** QBO tax codes/rates → app so quote tax matches QBO.
