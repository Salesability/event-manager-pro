# Atlantic Dealer Contact Refresh — Intent

**Created:** 2026-06-23

## Problem

The 0086 Atlantic BD import was **insert-only**. Its owner-vetted reconciliation
worksheet split 281 rooftops into **188 `import-new`** (inserted as prospects) and
**86 `skip-existing`** (dealers already live in prod). The import *honors* that
split — a `skip-existing` row hits `continue` with **zero writes**
(`scripts/import-atlantic-dealers.ts:192-196`). So the BD tracker's refreshed
**GM/SM contact names, emails, and phones** were never applied to those 86
existing dealers. This is parked follow-up **0086-c**.

The BD tracker is the freshest source of dealer contacts. For the 86 dealers
(the *active book*, not cold prospects), prod still carries whatever stale or
empty contact it had pre-import — and several of these are **active and/or
QuickBooks-linked**, so a quote or QBO Customer can be pointed at a wrong/missing
person.

## Desired outcome

For each of the 86 `skip-existing` prod dealers:
- its **primary contact** (name + primary email + primary phone) reflects the BD
  tracker's GM (and, per the open question below, optionally SM) contact, and
- because these are existing dealers — many **active or `quickbooksId`-linked** —
  the contact change **propagates to the linked QuickBooks Customer**
  (`GivenName`/`FamilyName`/`PrimaryEmailAddr`/`PrimaryPhone`), best-effort.

An **owner reviews a preview diff** (`current prod contact → BD-tracker contact`,
per row) before any write — the same vet-then-apply pattern 0086 used for dedup.
The apply step is **idempotent** and **audit-stamped**, run against prod via
`scripts/with-prod-db.sh`.

## Non-goals

- The **188 `import-new`** dealers — already handled by 0086. Not touched.
- **Re-auditing** the `import-new` vs `skip-existing` classification — it's
  owner-vetted; re-checking the full overlap is explicitly out of scope (the
  owner chose "the 86 skip-existing rows" as the target set).
- **No schema migration / no new UI** — a data-only script, mirroring the 0086
  import tooling. The UI single-contact edit path already exists (`updateDealer`).
- The **primary-contact designation overhaul** — that's [0089-dealer-contact-roles].
  This chunk targets the contact via the *current* model (staff link / title);
  it must not pre-empt 0089's taxonomy work. (Soft sequencing dependency — see
  Open questions.)
- Dealers the BD tracker doesn't cover.

## Success criteria

- A **preview report** lists, per skip-existing dealer: current prod primary
  contact (name/email/phone) → BD-tracker GM contact, each tagged
  `no-change` / `would-update` / `conflict` / `no-match`.
- The owner vets the preview — especially **`conflict`** rows where prod already
  holds a *different non-empty* contact (don't silently clobber).
- A write run updates **only owner-approved rows**; a re-run reports **0 changes**
  (idempotent).
- For each updated dealer that is `status='active'` **OR** has a `quickbooksId`,
  a **QBO push fires** (best-effort); a dormant/erroring QBO never blocks the DB
  update.
- Audit columns stamped (`updatedById` / `source`); denormalized
  `contactFirstName`/`contactLastName`/`primaryEmail`/`primaryPhone` refreshed so
  the QBO push reads the new values.

## Open questions

- **Conflict policy** — when prod already has a *different non-empty* primary
  contact, does the BD tracker win, or is the row flagged for a manual owner
  call? (Lean: **flag, don't auto-overwrite**.)
- **GM only, or GM + SM?** The BD tracker carries both slots; the existing import
  links both as `role='staff'` with `title` GM/SM. Refresh just the primary (GM),
  or also seed/refresh the SM as a second staff link?
- **Which contact to update** — the highest-priority staff link (the current
  `resolveQuoteRecipient` heuristic) vs. target explicitly by
  `title='General Manager'`. Targeting by title is robust to [0089]'s taxonomy
  change; the heuristic is not.
- **Sequencing vs [0089-dealer-contact-roles]** — 0089 introduces an explicit
  primary-contact designation. If 0089 ships first, this chunk targets the
  designation; if this ships first, it uses title/heuristic and 0089 migrates it.
  Soft dependency — owner decides ordering (default: park behind 0089).
- **Prod QBO connection** — how many of the 86 are QBO-linked, and is the prod
  QBO token live? (0086-d noted the prod token expired 2026-06-17; a reconnect
  at `/admin/quickbooks` may be needed before the push step does anything.)

## Why now

Un-parks **0086-c**. The reps are actively working the book on prod (0087 pipeline
+ 0090 commitment UX are live), so contact freshness on the 86 *existing* dealers
— the ones that actually quote and sync to QuickBooks — is the next gap to close
from the Atlantic import effort.
