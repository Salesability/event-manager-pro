# QuickBooks Dealer Sync — Intent

**Created:** 2026-06-08

## Problem

Chunk [0068](../closed/0068-quickbooks-oauth-viewer/plan.md) gave us an in-app, read-only QuickBooks OAuth viewer at `/admin/quickbooks`: connect → see the live customer list → disconnect. But it writes nothing. Our `dealers` rows and QuickBooks customers have **no stable link** between them — the only correlation is a fuzzy `lower(name)+lower(address)` match (how the [0060](../0060-quickbooks-integration/) one-time import seeded dealers). Without a durable QB customer ID on each dealer we can't reconcile, re-sync, or eventually push data back to QuickBooks without re-running the brittle name-match every time.

Concretely: production dealers already exist (created from a QuickBooks extract via the 0060 import) but **lack QB IDs**. Sandbox has no dealers at all. We want the existing Connect flow to be the data source that closes this gap.

## Desired outcome

- `dealers` carries a nullable, uniquely-indexed `quickbooks_id` column.
- The connected `/admin/quickbooks` page **stops being a passive customer list**. Instead, for each QB customer it shows the **computed sync action** against our DB — a read-only change-set preview:
  - **Create** — no match; a new dealer will be inserted with this QB ID. *(sandbox path)*
  - **Link → #N** — matched an existing dealer by `lower(name)+lower(address)` with no QB ID; the QB ID will be backfilled onto it. *(production path)*
  - **Already linked** — matched by `quickbooks_id`; nothing to do (idempotent).
  - **Skip** — matched a dealer already linked to a *different* QB ID (name+address collision); left untouched and reported.
- A deliberate **"Sync dealers"** button **applies** that change set through one env-agnostic upsert path (match by `quickbooks_id` → else match by name+address & backfill → else insert). After it runs, the page re-renders to the new state and shows a summary: created N · linked M · skipped K.
- Existing local `name`/`address`/`province` are **never clobbered** — province backfills only when null, mirroring the 0060 importer.

## Non-goals

- **Pushing data *to* QuickBooks** (Estimates/Invoices from accepted quotes) — read/import only.
- **Syncing contacts/people** — `quickbooks_id` lands on `dealers` (the company), not on `contacts`. The 0060 importer's contact-linking logic is untouched.
- **Webhooks / CDC / living sync** — this is an admin-triggered, on-demand pull, not a subscription.
- **Production OAuth keys / prod connection** — stays sandbox-only, exactly as 0068 left it. (The schema migration still gets applied to both DBs so the column exists when prod connects later.)
- **De-duping or merging existing dealers** — if the name+address heuristic doesn't match, we insert; we don't try to be clever about near-duplicates.
- **Retiring the 0060 import script** — it can later call the shared sync module, but rewiring it is out of scope here.

## Success criteria

- Migration adds `dealers.quickbooks_id` (nullable) + a **unique partial index** (`WHERE quickbooks_id IS NOT NULL`), applied to the **sandbox** DB (5432 session pooler) before any deploy.
- Re-running "Sync dealers" against an unchanged QB company is a no-op (no new rows, no duplicate links) — idempotent.
- A sandbox sync with zero pre-existing dealers **inserts** them all with QB IDs.
- Simulated "prod" path (a dealer pre-seeded by name+address, no QB ID) gets its **QB ID backfilled**, not a duplicate inserted.
- The sync is a **Server Action** (not a route handler) per repo convention; admin-gated via `assertCan('admin:access')`.
- The connected page renders the **per-customer change set** (Create / Link → #N / Already linked / Skip), not a raw customer table — and the action column is computed read-only on page load.
- `tsc` + tests green; chunk-end `/eval` PASS; browser smoke shows the change-set table + "Sync dealers" button on the connected viewer and the post-sync summary notice.

## Open questions

- **Sub-customers / Jobs.** QB `Customer` records can be sub-customers (`Job: true`, `ParentRef` set). Does the 0060 importer include them? Decision needed: skip jobs (sync only top-level companies) or import them as their own dealers. Default leaning: **skip `Job: true`** to avoid polluting `dealers` with line-item jobs — confirm against what 0060 actually did.
- **name+address collisions across two QB customers.** If two QB customers format to the same `name+address` (e.g. a parent and a job, or two records that normalize identically), the second match-by-name would try to backfill a QB ID onto an already-linked dealer. Rule: only backfill when `quickbooks_id IS NULL`; if already linked to a *different* QB ID, **skip and report** (don't clobber, don't error the whole batch).
- **Inactive customers.** `fetchCustomers` defaults to active-only. Keep that default for sync, or include inactive? Default: active-only (matches the viewer).

## Why now

0068 just shipped the connected viewer and the owner completed the live OAuth round-trip against the sandbox company (per `CURRENT.md`). The plumbing (token store, `fetchCustomers`, admin gating) is warm and proven — this is the natural next slice that turns "look at QB customers" into "reconcile them with our dealers," and it unblocks any future write-back by giving every dealer a stable QB identity.
