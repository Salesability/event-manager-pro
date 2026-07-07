# Production feed — dealer primary contact columns — Intent

**Created:** 2026-07-07

## Problem

The third-party production feed (`/api/production-feed`, chunk [0097](../0097-production-sheet-feed/plan.md)) was deliberately **PII-redacted** — it carries dates, dealer, location, format, coach, and the delivery volumes, but **no contact name/phone/email**. Implementers running an event at a dealership have no way to reach the dealer to coordinate. The owner needs the **dealer's primary contact** on the feed.

## Desired outcome

The feed CSV gains four columns — **`Contact`, `Contact Phone`, `Contact Email`, `Notes`** — the first three populated from the dealership's **designated primary contact** (the `is_primary` `dealer_contacts` link from chunk [0089](../0089-dealer-contact-roles/plan.md)), not the per-event booking contact stored on the campaign; `Notes` is the campaign's `notes` field (owner-requested — previously redacted as "internal-only", now deliberately surfaced to implementers). An implementer reading the shared Google Sheet can see who to call at each rooftop and any per-event note. Existing consumers keep working (columns are appended, not reordered).

## Non-goals

- **Not** the campaign's own booking contact (`campaigns.contact/phone/email`) — that stays redacted (it's per-event and sparse). Contact source is the dealer primary contact only. (`notes` IS now surfaced — the one deliberate exception, per the owner.)
- **No** new secret, **no** migration (the `is_primary` link + `contact_identifiers` already exist).
- **Not** the token-exposure fix — that's handled Sheet-side by the owner via the IMPORTRANGE indirection (a private source Sheet holds the token; implementers pull via `IMPORTRANGE`). This chunk assumes that indirection is in place so the new PII isn't sitting behind a viewer-readable token.
- **No** change to the row filter (still booked+upcoming) or the other columns.

## Success criteria

- `GET /api/production-feed?token=<valid>` returns the CSV with `Contact`, `Contact Phone`, `Contact Email`, `Notes` appended after `BDC` — the first three filled from the dealer's `is_primary` contact (blank when a dealer has no primary contact / no identifier), `Notes` from `campaigns.notes` (blank when null).
- The campaign's **own** `contact/phone/email` and audience source still **never** surface. (`notes` now DOES surface via the `Notes` column — the deliberate exception.)
- Header contract stays additive — a Sheet importing `A:J` is unaffected; `A:N` picks up the new columns.
- Unit + route tests green, including a rewritten redaction test that asserts the dealer primary contact **and `notes`** appear while the campaign booking contact does **not**.

## Open questions

- When a dealer's primary contact has a name but no email/phone identifier, emit blanks for the missing ones (assumed yes — mirror the existing null→blank mapper behavior).

## Why now

The owner asked for it directly while standing up the live feed for implementers ([0097](../0097-production-sheet-feed/plan.md) went live in prod 2026-07-07). Coupled with the Sheet-side IMPORTRANGE indirection so the added PII isn't exposed by the feed token.
