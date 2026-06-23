# 0089 Phase 1 — Decision gate

**Decided:** 2026-06-23 (owner-confirmed in the build session).

Resolves the four open questions in [`intent.md`](intent.md) → "Open questions (Phase-1 decision
gate)". All four landed on their leans.

## D1 — Designation shape: `is_primary` boolean (NOT a `primary | additional` enum)

Add a boolean `dealer_contacts.is_primary` (NOT NULL DEFAULT false) + a **partial-unique index**
`UNIQUE (dealer_id) WHERE is_primary` so a dealer has at most one primary contact.

**Why not the enum.** A `primary | additional` enum is a boolean wearing a costume — two
mutually-exclusive values, one the default — so it carries pgEnum machinery (create/alter/contract)
for no expressive gain, and the one-primary-per-dealer guarantee is the same partial-unique index
either way. The boolean also lets Phase 4 **fully drop** the legacy `dealer_contact_role` pgEnum
rather than keep an enum column around renamed — which is the whole point of the chunk (retire the
`customer/staff/prospect` taxonomy, don't rebrand it). An enum would only pay off if a *third*
designation were expected; see D2 — none is, and if one ever lands it's an additive boolean.

## D2 — Descriptive role: title-only, no extra flag

Rely solely on the existing free-text `dealer_contacts.title` for "what they do." No separate
`billing` flag or descriptive role in v1.

**Why.** 0091 already populated `title` ("General Manager" / "Sales Manager") on the Atlantic
dealers, so the descriptive side is covered. A billing-contact-vs-primary-contact split has no
stated need (intent non-goal), and adding it now means a second designation + a second resolver
path ahead of demand. If it ever lands it's an additive `is_billing` boolean — no cheaper with an
enum, so D1 isn't blocked by deferring it.

## D3 — Recipient tiebreak: lowest-id primary, then lowest-id emailable

`resolveQuoteRecipient` selects the dealer's `is_primary` contact that has a non-archived primary
email. Deterministic fallbacks:
- If `is_primary` is set but that contact has no emailable identifier → fall back to the lowest-id
  **emailable** non-archived contact (so a mis-designated primary never silently drops the send).
- If >1 `is_primary` somehow exists (defense-in-depth; the partial-unique index prevents it) →
  lowest `dealer_contacts.id` among primaries.
- If 0 primaries → lowest-id emailable contact (preserves hotfix A's never-strand behavior).
- If no emailable contact at all → the existing fail-closed `{ error }`.

This keeps hotfix A's fail-closed shape; it only swaps the *ordering key* from the role `case` to
`is_primary DESC`.

## D4 — Backfill rule: reproduce each dealer's current displayed priority-primary

Each dealer's current `DEALER_CONTACT_ROLE_PRIORITY` primary (staff > customer > prospect, then
lowest `dealer_contacts.id`, among non-archived rows) becomes that dealer's `is_primary` contact.
Goal: **nothing visibly moves** — the contact the dealer page shows today stays the primary.

**0091 interplay.** 0091 (D7 "Option A") repointed each skip-existing dealer's lowest-linkId staff
link to the GM precisely so the priority heuristic resolves the GM as primary; the 188 import-new
dealers got the GM created first (lowest id). So reproducing the priority-primary lands on the GM
where 0091 set one — the CURRENT.md "promote the titled GM rather than re-derive" note and this
rule converge by construction. **Phase 2 verifies** this: spot-check that the backfilled primary
== the `title='General Manager'` link on a sample of the 86 skip-existing dealers, and that every
dealer with ≥1 non-archived contact gets exactly one primary.

## Knock-on for the plan

- Phase 2 migration is **expand**: add `is_primary` + partial-unique index + backfill `UPDATE`
  (set `is_primary=true` for the priority-primary row per dealer). No drop yet.
- Phase 4 migration is **contract**: drop `dealer_contacts.role`, the
  `dealer_contacts_dealer_contact_role_unique` index, the `dealer_contacts_dealer_id_role_idx`
  index, and the `dealer_contact_role` pgEnum — once Phase 3 has moved every reader off `role`.
