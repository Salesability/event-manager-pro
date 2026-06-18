# Auto-create a QuickBooks customer for active dealers — Intent

**Created:** 2026-06-18

## Problem

Creating a dealer in the app does **not** put it in QuickBooks. The app→QBO
direction exists only as a manual, per-dealer **"Push to QuickBooks"** button on
each dealer's page (`/dealerships/[id]`, chunk 0070) — the back-office has to
remember to open each new dealer and click it. The everyday flow ("add a dealer")
leaves QuickBooks out of sync until someone does that by hand.

Two specific gaps:

1. **No auto-push on dealer creation.** `createDealer` (and the prospect→active
   conversion `convertProspectToActive`) never touch QuickBooks.
2. **The contact person's name is dropped even when a dealer *is* pushed.**
   `mapDealerToCustomer` (`src/lib/quickbooks/dealer-push.ts`) maps only the
   company name (`DisplayName`/`CompanyName`), the address, and the contact's
   **email** + **phone** (`PrimaryEmailAddr`/`PrimaryPhone`). The contact
   person's first/last name never reaches QuickBooks — `QboCustomerInput`
   (`client.ts`) doesn't even carry `GivenName`/`FamilyName`.
3. **Edits don't propagate — churn leaves QuickBooks stale.** Once a dealer is
   linked, *nothing* keeps it current: editing a dealer's contact in the app
   (`updateDealer`) doesn't reach QuickBooks, and the Sync (`applyDealerSync`)
   deliberately **never overwrites** an already-linked dealer. Dealer/contact
   churn (people leave, emails/phones change) drifts the two apart.

## Desired outcome

**Source of truth = the app** (owner decision, 2026-06-18). Dealer/contact info
is edited in the app; the app is authoritative and **pushes** changes to
QuickBooks. The Sync (QB→app) stays **non-clobbering** — it only *creates*
dealers that exist in QuickBooks but not the app; it never overwrites app dealer
data. So churn is handled by **propagating app edits outward**, not by pulling
QuickBooks back over the app.

- When an **active** dealer is created in the app — or when a **prospect is
  converted to active** — a QuickBooks **Customer** is created automatically and
  the dealer is linked (`quickbooks_id` backfilled), reusing the existing 0070
  push.
- When an **active / already-linked** dealer is **edited** in the app, the change
  is pushed to its QuickBooks Customer (update path of the 0070 push), so contact
  churn keeps QuickBooks current.
- The push is **best-effort**: it must **never block or roll back** the dealer
  write. If QuickBooks isn't connected, or the push errors, the dealer is saved
  normally and simply left unlinked (the owner can still Push manually / the Sync
  button links it later). Mirrors the calendar best-effort pattern (0077).
- **Prospects are not pushed** — only real customers (active dealers) become QB
  Customers, so QuickBooks isn't cluttered with leads.
- The QuickBooks Customer now carries the **contact person's name**
  (`GivenName`/`FamilyName`) in addition to the company name, address, email, and
  phone — so a pushed dealer has a proper human contact in QuickBooks.

## Non-goals

- **Sync stays non-clobbering — QuickBooks never overwrites app dealer data.**
  The app is the master (decision above), so `applyDealerSync` is *unchanged*: it
  only creates QB-only dealers + links, never updating an already-linked dealer
  from QuickBooks. (This is the explicit *opposite* of the item catalog, where QB
  is the master.)
- **No separate QBO `Contact` entities.** We map the primary contact's
  name/email/phone onto the Customer's own fields, not a child Contact record.
- **No change to the manual per-dealer Push (0070) or the unified Sync (0083).**
  Those stay as-is; this *automates* the push for the create / activate / edit
  paths and adds the contact-name mapping.
- **No prospect→QB push**, by the active-only decision above (a prospect edit
  also doesn't push, unless the dealer is already linked).

## Success criteria

- Creating an **active** dealer with QuickBooks connected → a QB Customer is
  created and the dealer row gets a `quickbooks_id`.
- Creating a **prospect** → **no** QuickBooks write.
- Converting a prospect → active (`convertProspectToActive`) → the dealer is
  pushed to QuickBooks.
- **Editing** an active / already-linked dealer → the linked QuickBooks Customer
  is updated to match (so a changed contact/email/phone/address propagates).
- QuickBooks **not connected** (or the push throws) → the dealer still saves; no
  error surfaces to block the create; the dealer is left unlinked.
- The mapped QB Customer payload includes the contact person's
  `GivenName`/`FamilyName` (when the dealer has a contact), alongside the existing
  company/address/email/phone.

## Open questions

- **Duplicate-name (Intuit 6240) on auto-create.** If QuickBooks already has a
  customer with the same name, the create path throws `QboDuplicateNameError`.
  Best-effort default = leave the dealer **unlinked** (owner reconciles via Sync
  / manual Push). Alternative = **link to the existing** QB customer by name (the
  `applyDealerSync` match-by-name path). *Resolve in the Phase-1 decision gate.*
- **UI feedback.** Should the create/convert flow surface "also created in
  QuickBooks" / "couldn't reach QuickBooks", or stay fully silent (the dealer
  page already shows the QB link status)? *Resolve in the Phase-1 decision gate.*

## Why now

The owner is doing a focused pass on the QuickBooks surface (0083) and wants
app-created dealers to flow into QuickBooks automatically instead of relying on a
manual per-dealer click. The contact-name mapping gap surfaced while reviewing
what the dealer push actually sends to QuickBooks.
