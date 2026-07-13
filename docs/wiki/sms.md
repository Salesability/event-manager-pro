# Campaign SMS (Twilio)

Campaign-driven text messaging to a dealership's customer list — the first Module-2 (Event Production Console) channel. Shipped by chunk [`0103-sms-service`](../chunks/closed/0103-sms-service/plan.md) (2026-07-13); product decisions in its [`decision.md`](../chunks/closed/0103-sms-service/decision.md) (D1–D5). Ledger continuity (consent snapshots + identity fingerprint + history badges) added by [`0105-sms-ledger-continuity`](../chunks/closed/0105-sms-ledger-continuity/plan.md) same day.

## The add-on gate (D1)

SMS is **not** a universal channel — it's a service the dealer buys via the quote's item pull-down. The surface (an "SMS" button in the `/calendar` event dialog + the `/calendar/[id]/sms` page) lights up only when the campaign is `booked` **and** `campaigns.sms_email > 0` — i.e. the accepted quote carried **Digital (SMS / Email)** (`digital-record`) touches, snapshotted at accept time by the 0094 delivery-metrics writer. No flag column exists. Caveat accepted at decision time: the catalogue item is one combined SMS-or-email bucket.

## Flow

1. **Import** (`importSmsRecipients`) — per-campaign CSV of the **dealer's** contact list (`phone, first_name, last_name, consent_basis, last_contact_at`) into `sms_recipients`. Wholesale replace per import; all-or-nothing row validation (E.164 normalization with NANP default, real-calendar + not-future `last_contact_at`); parser in `src/features/sms/import-csv.ts`.
2. **Review** — `evaluateCampaignRecipients` (`src/features/sms/queries.ts`) computes per-recipient eligibility + the exclusion summary. The panel and the launch action share this one function, so the pre-send review can never promise a different audience than the launch enforces.
3. **Launch** (`launchSmsSend`) — persist-first: one `sms_sends` row (carries the body template + exclusion snapshot) + one `sms_messages` row per eligible recipient inside a transaction (with a campaign-scoped advisory lock + 60s duplicate-launch guard), then a sequential per-recipient Twilio dispatch (`src/lib/sms/send.ts` via the Messaging Service). Personalization (`{{first_name}}`/`{{last_name}}`/`{{dealer_name}}`, `src/lib/sms/template.ts`) renders per recipient at dispatch and is never persisted. A STOP footer is auto-appended unless the body already mentions STOP; the 1600-char cap is checked post-footer. Each phone is re-checked against `sms_opt_outs` immediately before its Twilio call (closes the STOP-races-launch window).
4. **Track** — Twilio status callbacks land on `POST /api/twilio/webhook` and flip `sms_messages.status` monotonically (`queued → sent → delivered/undelivered/failed`; out-of-order callbacks can't regress, unknown SIDs 404 so raced callbacks retry). Inbound STOP replies (`STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT`, whole-message) insert into `sms_opt_outs` idempotently.

## Compliance floor

- **Opt-out is permanent and global.** `sms_opt_outs` is keyed on bare phone number, has no FKs, is never purged, and beats express consent. Sources: `stop_reply` (webhook) and `manual` (`addSmsOptOut`).
- **CASL consent staleness** (fixed windows, D3): implied consent from a purchase/contract lapses **24 months** after `last_contact_at`; from an inquiry, **6 months**; express never lapses; an implied-basis recipient with no last-contact date is never sendable. Pure predicate in `src/features/sms/eligibility.ts`.
- **Retention (D5):** dealer-supplied identity data (`sms_recipients`) is hard-deleted **24 months after import** (`scripts/purge-sms-recipients.ts`, dry-run default). The ledger survives, minimized — `sms_messages.recipient_id` goes NULL, the phone snapshot stays, and the body lives once on the send row so no customer names linger. Purpose: the CASL defense record ("texted this number on this date, delivered, STOP honored").
- **Ledger self-sufficiency (0105):** each message row is also stamped at launch with `consent_basis` + `last_contact_at` (send-event snapshots), so the ledger proves *on what consent basis the send was lawful* with no join to purgeable data.

## Ledger continuity across a purge (0105)

The phone snapshot is the re-linking key when a dealer signs on again after a purge — but phones get recycled, so it proves *number* continuity, not *person* continuity. Shoring it up:

- **Identity fingerprint:** `identity_hmac` = HMAC-SHA256 over the normalized name + phone, keyed on `SMS_IDENTITY_HMAC_KEY`, format `<8-hex key id>:<64-hex hmac>` (`src/lib/sms/identity.ts`). Stamped on recipients at import, snapshotted onto message rows at launch. **Verification-only** — a candidate identity can be checked against history; names can never be read back out. PIPEDA posture (we hold the key ⇒ pseudonymous personal data, retained as documented minimization) recorded in [`0105 decision.md`](../chunks/closed/0105-sms-ledger-continuity/decision.md) D2. Degradation: unset key / nameless row ⇒ NULL; key rotation ⇒ old fingerprints read `unknown` via the key-id prefix (never a false "differs").
- **History surfacing:** the pre-send review's "Prior sends for this dealer" block (`loadRecipientHistory`, dealer-scoped by design — never cross-dealer) shows per-number prior-send counts, last outcome, and the continuity verdict: green "same person as before" / amber "name differs from prior sends" (likely recycled number — treat inherited history with suspicion).
- **Concurrency:** import and launch share a campaign-scoped advisory lock, and launch evaluates recipients *inside* its locked transaction — a re-import can't swap the list between the review's promise and the send's snapshot.

## Auth & security

- All three Server Actions gate on the **`sms:send` capability — admin-only for v1** (D4); the `/calendar/[id]/sms` page runs `assertCan('sms:send')`.
- The webhook is public (external caller); the gate is **`X-Twilio-Signature` verification** (base64 HMAC-SHA1 over URL + alphabetically-sorted form params, keyed on the auth token; `src/lib/sms/webhook-verify.ts`), performed before any DB touch. The signature base URL is built from `SITE_URL`, never the request Host. Twilio's scheme has no timestamp → no replay window; replays are no-ops (monotonic flips + idempotent opt-out insert).
- **Dev-redirect failsafe** mirrors `EMAIL_DEV_TO`: unless `APP_ENV=production`, every send is rewritten to `SMS_DEV_TO` (body prefixed `[DEV→+1…]`) or **refused** if unset (`src/lib/sms/send.ts`).

## Vendor & env

Twilio, addressed via a **Messaging Service** (`TWILIO_MESSAGING_SERVICE_SID`) so the sender number can be swapped without code changes. Sender strategy (research: [`0103 research.md`](../chunks/closed/0103-sms-service/research.md)): one Salesability-owned **verified toll-free number** — Canada has no 10DLC registry, unverified toll-free is carrier-blocked, short codes need a 12–16-week Canadian provisioning runway. Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `SMS_DEV_TO` (see `.env.example`). Owner provisioning runbook: [`go-live-accounts.md`](go-live-accounts.md) §6 — **as of 2026-07-13 the Twilio account is not yet provisioned**; the code path is complete to the SDK boundary and stage-testable once creds exist.

## Open questions / parked

- **0103-a (durable dispatch)** — a crash in the Twilio-accept→persist-SID gap can orphan a `queued`-no-SID ledger row; the double-launch guard is a 60s window, not a launch-in-progress lock. Fix shape: outbox/worker or an "active send" status. Parked in `CURRENT.md`; see [`eval-2026-07-13-1005.md`](../chunks/closed/0103-sms-service/eval-2026-07-13-1005.md).
- Recipient lists are per-campaign CSV snapshots — durable contact records / DataLoader buckets are Module 1 (vision), explicitly out of scope here.
