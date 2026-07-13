# SMS Ledger Continuity (consent snapshot + identity fingerprint + history surfacing) — Intent

**Created:** 2026-07-13

## Problem

0103's retention design (D5) hard-deletes `sms_recipients` at 24 months while the
`sms_messages` ledger survives keyed by a bare phone-number snapshot. Owner review
(2026-07-13) surfaced two gaps:

1. **The ledger loses its consent evidence at purge.** `consent_basis` and
   `last_contact_at` live only on the recipient row — after the purge, the ledger
   can prove *what was sent where and when*, but not *on what consent basis it was
   lawful*. The CASL defense record should be self-sufficient forever.
2. **The phone key is number-identity, not person-identity.** Phone numbers get
   recycled. When a dealer signs on again after a purge and re-imports their list,
   a bare phone join says "this number has history," not "this is the same
   customer." The reconstitution key needs shoring up — without re-holding the
   dealer's customer identities past the retention window.

Additionally, the pre-send review shows no prior history even where it exists —
staff can't see "previously texted for this dealer / previously failed / identity
matches prior sends" at review time.

## Desired outcome

- **Consent-evidence snapshot:** each `sms_messages` row carries the recipient's
  `consent_basis` + `last_contact_at` as stamped at launch. The ledger reads
  "texted this number on this date, delivered, under implied-purchase consent
  with last dealer contact <date>" with no join to purgeable data.
- **Keyed identity fingerprint:** an HMAC-SHA256 over the normalized identity
  (name + phone), keyed with an app-held secret, stamped on recipients at import
  and snapshotted onto message rows at launch. **Verification-only**: a candidate
  identity can be checked against history; names can never be enumerated back
  out. On re-import after a purge, match ⇒ person-verified continuity;
  mismatch ⇒ likely recycled number, treat history/consent with suspicion.
- **Pre-send review history badges:** per recipient, the review shows prior
  send history for this dealer (texted before / last delivery outcome / STOP
  handled already by exclusion) and the identity-fingerprint verdict
  (matches / differs / no key or no history).
- Purge behavior unchanged: recipients still hard-delete at 24 months; the new
  columns are send-event metadata that survives by design.

## Non-goals

- No change to the purge boundary, the opt-out registry, or the eligibility
  windows (0103 D3/D5 stand).
- No durable person entities / DataLoader (Module 1) — the fingerprint is a
  verification token, not a contact record.
- No cross-dealer identity surfacing (history badges are dealer-scoped; the
  global ledger stays an internal compliance record).

## Open questions

- None blocking. PIPEDA posture recorded in `decision.md`: the keyed hash is
  pseudonymous personal data (we hold the key) retained as deliberate,
  documented minimization — verification-only, secret in Secret Manager.

## Success criteria

- A launched message row carries `consent_basis`, `last_contact_at`, and
  `identity_hmac`; deleting its recipient (purge) leaves all three intact
  (integration-proven).
- The same (name, phone) always yields the same fingerprint across import
  sessions; a changed name on the same phone yields a different one; unset key
  yields NULL and everything else still works (unit-proven).
- The pre-send review renders history badges against seeded prior sends
  (browser smoke).

## Why now

Owner called for it during the 0103 close-out review ("fold" — 2026-07-13),
before the branch merges and before any prod data exists, so the columns ship
in the same deploy as the base tables and no backfill is ever needed.
