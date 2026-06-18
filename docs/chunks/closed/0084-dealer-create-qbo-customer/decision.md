# 0084 — Decisions

All settled with the owner on 2026-06-18 (Phase-1 decision gate).

## Source of truth = the app

Dealer/contact data is edited in the app; the **app is authoritative**. Changes
propagate **app → QuickBooks** (push). The Sync (QB → app, `applyDealerSync`)
stays **non-clobbering** — it only *creates* QB-only dealers + links, never
overwrites an already-linked dealer. (Explicit opposite of the item catalog,
where QuickBooks is the master.)

## Scope of the auto-push

- **Active-only on create.** A new dealer pushes to QB only when its status is
  `active`. Prospects are not pushed (avoids cluttering QuickBooks with leads).
- **Activate.** `convertProspectToActive` pushes (the prospect just became a
  real customer).
- **Edit (D2) — active OR already-linked.** `updateDealer` pushes when the dealer
  is active **or** already has a `quickbooks_id`. Rationale: keep QuickBooks
  current for every dealer that's a real customer (and for anything already
  linked), without pushing pure prospects. An already-linked dealer takes the
  push's **update** branch (fresh SyncToken read-before-write); an active-but-
  unlinked dealer takes the **create** branch (auto-link).
- **Best-effort / connected-only.** The push never blocks or rolls back the
  dealer write; if `getValidAccessToken()` throws (QBO dormant/not connected) or
  the push errors, the dealer saves regardless. Mirrors the calendar best-effort
  pattern (0077).

## D1 — QuickBooks duplicate name (Intuit 6240) on auto-create → **leave unlinked**

On a 6240 the dealer saves but stays **unlinked**. **No auto-link by bare name.**
Rationale: the app deliberately treats dealer *name* as non-unique (two
same-named businesses are allowed; identity is name **+ address**, per
`applyDealerSync`), so linking a new dealer to a same-named QB customer by bare
name could merge two genuinely different businesses. The owner reconciles via the
Sync (name+address match) or the manual Push. (A careful name+address auto-link
is a possible future refinement, not in scope.)

## D3 — UI feedback → **silent**

No new notice on the create/convert/edit result. The dealer page already shows
the QuickBooks link status, so a failed/skipped push is discoverable there.
(Easily upgraded later to a surfaced "synced to QuickBooks / couldn't reach it"
message if desired — it's a one-line addition.)

## Out of scope (separate concerns)

- **App-side dealer dedup.** Guarding against duplicate dealers *within the app*
  (warn/block on a duplicate name+address at create) is a separate concern — the
  app has no dealer-name uniqueness today (only `public_id` + `quickbooks_id` are
  unique; contacts dedup email/phone, dealer names are free). Its own future
  chunk if wanted.
- **Sync overwriting app data** (QB → app) — excluded by the source-of-truth
  decision.
- **Separate QBO `Contact` entities** — we map the primary contact's
  name/email/phone onto the Customer's own fields only.
