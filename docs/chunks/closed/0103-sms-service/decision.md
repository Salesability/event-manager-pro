# 0103 — Decisions

Owner-confirmed 2026-07-13 (pre-Phase-2 product-question pass; resolves the
`intent.md` open questions the schema depends on).

## D1 — SMS gate: derived from the accepted quote's line items

*"Everything is an add-on; the mechanism is the item pull-down on the quote."*
The SMS surface (compose/launch panel) appears on a campaign when its accepted
quote includes **Digital (SMS / Email)** touches — i.e. `campaigns.sms_email > 0`
(the 0094 accept-time snapshot of `digital-record` line qty). **No new flag, no
schema.** Caveat accepted: the catalogue item is a combined SMS-or-email bucket,
so buying digital touches lights the SMS panel even if the dealer intends email
only — fine for v1, that's how the service is sold.

## D2 — Recipients: per-campaign import of the dealer's contact list

Each campaign is given the **dealer's** contact list, imported per campaign
(CSV) into `sms_recipients` (phone, name, consent basis, last-contact date).
No first-class contact entities — that's Module 1 (DataLoader) territory.
A **permanent global `sms_opt_outs` table keyed by phone number** sits beside it.

## D3 — Consent-staleness windows: fixed CASL defaults

Hardcoded in the eligibility predicate: **purchase/contract → 2 years, inquiry →
6 months, express consent → no expiry.** No settings schema/UI; changing a window
is a code change.

## D4 — Launch gate: admin-only for v1

`sms:send` capability granted to the admin role only, with a confirm dialog at
launch. Widen later if the coach-owned model needs it.

## D5 — Retention: hard-delete dealer data at 24 months; the ledger survives, minimized

Dealer-supplied data is kept only for an 18–24-month window (owner practice);
we implement the boundary as **hard-delete at 24 months from import**, aligned
with CASL's 2-year implied-consent ceiling (staleness exclusion stops sends well
before the purge).

Split by table:
- **Purged:** `sms_recipients` rows ≥ 24 months old — names, consent basis,
  last-contact dates (the dealer's customer identities leave our system).
- **Kept permanently (the compliance ledger):** `sms_messages` — phone, Twilio
  message SID, delivery status, timestamps, campaign link. The message **body is
  stored once per launch** (on the send/launch record), never re-rendered per
  recipient into the ledger, so no customer names linger after purge. Keeping
  the ledger is the CASL defense record ("texted this number on this date,
  delivered, STOP honored").
- **Kept permanently:** `sms_opt_outs` — bare phone numbers; honoring STOP
  outlives the dealer relationship. Purging them with the list would let a
  re-imported person be texted after they said stop.

Consequence for schema: `sms_messages.recipient_id` must tolerate its recipient
row being deleted (nullable FK, `ON DELETE SET NULL`), with the phone number
snapshotted onto the message row at send time.
