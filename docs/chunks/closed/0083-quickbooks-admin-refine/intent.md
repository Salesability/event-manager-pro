# QuickBooks admin page refine — Intent

**Created:** 2026-06-17

## Problem

The `/admin/quickbooks` page (`src/app/(app)/admin/quickbooks/page.tsx` →
`src/features/quickbooks/quickbooks-admin.tsx`) grew organically across chunks
0068/0069/0071/0072/0076 and now reads as a single long scroll that makes the
admin think too hard:

- The **connection status / Connect** control is buried *below* the local
  service-item catalog (`ServiceItemsList` renders first on the page), so the
  most important "are we connected?" affordance isn't at the top.
- There are **two separate write buttons** — "Sync dealers" and "Pull items" —
  each gated on its own `actionable > 0` count and parked next to its own
  table. The admin has to understand the dealer/item distinction, scan two
  diff tables, and decide *which* button to press. That's cognitive load for an
  action that should be one decision: "make us match QuickBooks."
- Dealers, items, and (historically) tax all stack vertically as flat sections,
  so there's no visual grouping and the page just gets longer.

## Desired outcome

A calmer, single-decision page:

- The **connection bar is the first thing on the page** — Connect when
  disconnected; "Connected · realm · last-synced" plus the controls when
  connected.
- **One primary "Sync" button** in that bar. One click reconciles dealers
  (QBO→app create/link, never clobbering app-authored dealer data) *and*
  mirrors items from QuickBooks into the local catalog (create/update/archive/
  purge), then shows **one combined summary** notice. Items are mirrored
  silently because **QuickBooks is the source of truth for items and the app
  never mutates them** — there is nothing app-authored to protect.
- The per-section detail moves into **tabs** below the bar: a **Dealers** tab
  (the customer→dealer reconcile table) and an **Items** tab (the local catalog
  list + the pending QBO mirror diff).
- **No Tax tab.** Tax-code mapping deliberately lives at `/admin/lookups` (chunk
  0076); the page shows a small "Tax codes are managed in Lookups →" link
  instead of duplicating that surface.
- **Disconnect** stays available as a secondary control in the bar.

A reader landing on the page should be able to (a) see connection state
instantly, (b) press one button to reconcile everything, and (c) drill into
dealer vs item detail via tabs only if they want to — without being forced to.

## Non-goals

- **Not** changing the underlying reconcile logic — `dealer-sync.ts`
  (`computeDealerSyncPlan` / `applyDealerSync`) and `item-sync.ts`
  (`computeItemSyncPlan` / the pull apply) are untouched; we only add a thin
  unified action wrapper and reorganize the UI.
- **Not** touching the per-dealer **Push to QuickBooks** (app→QBO) action on
  `/dealerships/[id]` (chunk 0070). That stays a per-dealer control.
- **Not** bringing the tax-code mapping surface onto this page — it stays at
  `/admin/lookups` (0076).
- **Not** introducing any in-app mutation of items — the catalog stays a
  read-only mirror of QuickBooks (0071/0072).
- **Not** adding selective/partial sync (per-row checkboxes, "sync only these
  dealers"). One button reconciles the whole computed plan.

## Success criteria

- The connection bar (Connect, or status + Sync + Disconnect) renders **first**
  on the page, above the tabs and above the catalog list.
- When connected there is **exactly one** sync control (plus Disconnect) — no
  separate "Sync dealers" / "Pull items" buttons remain.
- Pressing **Sync** applies both the dealer reconcile and the item mirror and
  surfaces **one** combined summary message.
- Dealers and Items each have their **own tab**; Tax is a **link** to
  `/admin/lookups`, not a tab.
- Items remain QB-mastered — no new code path lets the app edit an item.
- `tsc` + lint clean; the page renders in the not-connected and connected
  states without client-JS regressions on the server-action forms.

## Open questions

- ~~**Combined-summary encoding**~~ — **Resolved 2026-06-17:** single combined
  `?qbsync=<dealers>.<items>` param (one-sentence notice); drop the separate
  `?synced=`/`?itemsynced=` reads.
- ~~**Partial failure**~~ — **Resolved 2026-06-17:** partial-report. Attempt both
  passes independently; a throw in one never discards the other's committed
  result. The notice reports each part's outcome (and the failed part's message)
  rather than propagating a single error.
- **Sync button when nothing is actionable:** always show it as a no-op that
  reports "already up to date", or hide/disable it? (Lean: always present —
  "don't make them think" means the button is where they expect it regardless.)
- ~~**Default active tab**~~ — **Resolved 2026-06-17:** Dealers.
- ~~**Tab label**~~ — **Resolved 2026-06-17:** "Dealers" (app noun); the in-tab
  table header still reads "Company".

## Why now

The user is doing a focused pass on the admin QuickBooks surface and explicitly
called out the three pain points (connect-at-top, tabs per section, one-click
sync). The reconcile logic is stable and shipped; this is purely an
information-architecture / affordance refinement on top of it.
