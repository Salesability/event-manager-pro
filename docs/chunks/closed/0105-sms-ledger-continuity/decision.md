# 0105 — Decisions

Owner-directed 2026-07-13 ("fold" — during the 0103 close-out review, before the
branch merge, so the columns ship with the base tables and no backfill exists).

## D1 — The ledger carries its own consent evidence

`sms_messages` rows are stamped at launch with `consent_basis` +
`last_contact_at` (send-event snapshots). Rationale: after the 24-month
recipient purge (0103 D5), the ledger must prove not just *what was sent where
and when* but *on what consent basis it was lawful* — with no join to
purgeable data. These are facts about **our send event**, not the person's
ongoing identity, so retaining them doesn't undercut the purge.

## D2 — Keyed identity fingerprint shores up the phone key

Phone numbers get recycled, so the bare phone snapshot proves *number*
continuity, not *person* continuity. `identity_hmac` = HMAC-SHA256 over the
normalized name + phone, keyed on `SMS_IDENTITY_HMAC_KEY` (Secret Manager),
stamped on `sms_recipients` at import and snapshotted onto `sms_messages` at
launch. On a re-import after a purge: match ⇒ same name-on-number
(person-verified continuity); mismatch ⇒ likely recycled number — inherited
history/consent gets an explicit warning badge.

**Privacy posture, stated plainly:** a keyed hash is verification-only by
construction (a candidate identity can be checked; names can never be
enumerated back out), but under a strict PIPEDA reading it is still
pseudonymous personal data because we hold the key. We retain it as
deliberate, documented minimization — the alternative (keeping names) defeats
the purge; the alternative (nothing) leaves the compliance record blind to
number recycling.

Degradation rules: unset/malformed key ⇒ NULL fingerprints, everything else
works (the check degrades to the bare phone key). Nameless rows ⇒ NULL (a
phone-only hash adds nothing over the phone column and would false-mismatch
later name-carrying imports). Key rotation orphans prior fingerprints — they
read as "unknown", never as a false match.

## D3 — History surfacing is dealer-scoped

The pre-send review's "Prior sends for this dealer" list joins
`sms_messages.phone → sms_sends → campaigns.dealer_id` — deliberately NOT
cross-dealer: dealer A must not see that dealer B texted the same person. The
global ledger stays an internal compliance record; the cross-dealer opt-out
registry remains the only cross-dealer enforcement (as designed in 0103).
