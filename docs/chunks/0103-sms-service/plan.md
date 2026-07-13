# SMS Service (Twilio + campaign-driven texts) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Research spike + vendor foundation (Twilio account, sender-number strategy, `src/lib/sms/` client, env/secrets) | Done | `35b9d36` |
| 2: Schema — `sms_messages`, `sms_sends`, per-campaign recipients, permanent `sms_opt_outs` (+ migration) | Done | `8099dc5` |
| 3: Compose + launch Server Actions (campaign-driven payload, personalization variables, opt-out exclusion, idempotent send) | Done | `80dbc2c` |
| 4: Twilio status-callback webhook (delivery tracking) + inbound STOP → opt-out capture | Done | - |
| 5: UI — campaign-detail SMS panel (compose, pre-send review summary, send log) | Pending | - |
| 6: Tests + smoke verification | Pending | - |

The app has no SMS capability; the vision (Module 2, Event Production Console) makes SMS a first-class campaign channel — but **as a per-campaign add-on, not something every campaign uses**. This chunk builds the Twilio integration + the campaign-driven text send: on campaigns where the SMS add-on is active, staff compose an SMS derived from campaign data, attach a recipient list, launch, and track delivery — with a hard compliance floor: permanent STOP/opt-out enforcement **and** consent-staleness exclusion (a dealer's list opt-in lapses when there's been no dealer↔customer contact within the CASL implied-consent window; stale recipients are excluded and reported at pre-send review). "Done" = a real SMS delivers from stage (dev-redirected), status lands back via webhook, a STOP reply permanently excludes that number, and a stale-consent recipient provably never sends. See `intent.md` for non-goals (no DataLoader, no two-way console, no AI creative) and the open questions (what flips the add-on on — quote-derived vs explicit flag; staleness field requirements).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/sms/client.ts` (Twilio SDK factory) | `src/lib/boldsign/client.ts:22` | Same layer: `'server-only'`, module-cached vendor client, `process.env` guard with inline `{ error }` return, `__resetForTests()` |
| `src/lib/sms/send.ts` (send wrapper + dev-redirect) | `src/lib/email/send.ts:46` | `decideRedirect()` is the exact `EMAIL_DEV_TO` / `APP_ENV==='production'` gate to mirror (`SMS_DEV_TO` or shared dev target); copy the `SendInput`/`SendResult` union shape |
| `src/lib/sms/webhook-verify.ts` | `src/lib/boldsign/webhook-verify.ts:57` | Structural template: constant-time compare (`timingSafeEqual`), replay window. NB Twilio's scheme differs — HMAC-SHA1 over URL+sorted params (`X-Twilio-Signature`), not raw-body HMAC-SHA256 |
| `src/app/api/twilio/webhook/route.ts` | `src/app/api/boldsign/webhook/route.ts:140` | Same layer (external-caller route handler): raw body before parse, verify **before** any DB touch, `authz: public — gate is HMAC` comment convention, 2xx-or-retry contract |
| `src/lib/db/schema/sms-messages.ts` (+ recipients, opt-outs) | `src/lib/db/schema/contact-identifiers.ts` + `src/lib/db/schema/quotes.ts:42` | Small child-table shape (mixins from `_columns.ts`, partial-unique index) + status-enum & send-tracking columns (`sentAt`, provider id ≈ `providerDocumentId` pattern); register in `schema/index.ts` |
| `src/features/sms/actions.ts` (compose/launch) | `src/features/msa/actions.ts:151` | `sendMsaEnvelope` is the "send external + persist provider SID + idempotency guard + atomic guarded UPDATE" template; capability gate via `capabilityClient()` (`src/lib/actions/action-client.ts:52`) with a new `sms:send` |
| Campaign → payload derivation | `src/features/email/actions.ts:89` | `sendClientCampaignConfirmation`: load campaign, guard `status==='booked'`, build message body from campaign fields — the direct analog for campaign-driven SMS payloads |
| SMS add-on gate (is SMS active on this campaign?) | `src/features/quotes/campaign-delivery.ts:46` | `applyAcceptedQuoteToCampaign` / `deriveDeliveryMetrics` is where the accepted quote already decides `campaigns.sms_email` — read it before choosing quote-derived vs explicit-flag (intent open question #1) |
| Consent-eligibility predicate (opt-out + staleness) | `src/features/quotes/accept-gate.ts` | Pure, executor-injectable, real-DB-tested predicate module — the shape for `isRecipientEligible(consentBasis, lastContactAt, optedOut)` so the CASL window logic is unit-testable in isolation |
| Delivery-status model (per-message `queued/sent/delivered/failed`) | `src/lib/db/schema/campaigns.ts:34` | `campaignGcalSyncStatus` trio is the existing best-effort, app-is-source-of-truth, manual-retry projection-status pattern |
| `.env.example` Twilio block | `.env.example` BoldSign block | Same doc-comment style; that block also documents the shared-dev-redirect rationale to follow |
| `src/lib/db/schema/sms-sends.ts` (added Phase 2, not in original sketch) | `src/lib/db/schema/quote-attachments.ts` | One-row-per-launch parent of `sms_messages`; carries the body ONCE (D5 — no per-recipient rendered bodies in the ledger) + the pre-send exclusion-count snapshot |
| Campaign-detail SMS panel | event-detail component in `src/features/schedule/` hosting the Email Client / Email Coach actions | Same surface, same layer — the SMS panel sits beside the existing per-campaign messaging actions (locate exact file at build time; add row here) |

**Conventions referenced:**
- `docs/wiki/conventions.md` — mutations via Server Actions; route handler only for the Twilio webhook (external caller).
- `docs/wiki/data-model.md` + the `db-conventions` skill — mixins, enum/index conventions, migration workflow (invoke before writing schema).
- `docs/wiki/security.md` — five-layer map; webhook is public with HMAC as the gate.
- `docs/wiki/go-live-accounts.md` — add the Twilio account to the provisioning runbook (owner-owned account, sandbox/prod key split like BoldSign/Resend).
- `docs/wiki/commercial-spine.md` — campaigns are operational delivery; SMS hangs off the campaign, not the quote.

**Overall Progress:** 67% (4/6 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- Phase 1 has owner-driven pieces (Twilio account creation, number purchase/verification) — flag early, don't block the code scaffold on them
- No `twilio` dependency exists yet; no message-log table exists yet (both are net-new)

### Phase Checklist

#### Phase 1: Research spike + vendor foundation
- [x] Research spike: Canadian A2P sender-number strategy (long code vs toll-free-verified vs short code; CRTC/carrier filtering; Twilio Messaging Service) → `research.md` with a recommendation (one verified toll-free number + Messaging Service)
- [x] Add the `twilio` dependency (`twilio@6.0.2`)
- [x] `src/lib/sms/client.ts` — module-cached Twilio client factory, env guard with `{ error }` return, `__resetForTests()` (anchor: `src/lib/boldsign/client.ts:22`)
- [x] `src/lib/sms/send.ts` — `sendSms` wrapper with the inverted dev-redirect gate (`APP_ENV==='production'` real-sends; else redirect to `SMS_DEV_TO` or refuse) (anchor: `src/lib/email/send.ts:46`)
- [x] `.env.example` Twilio block (creds, Messaging Service SID, `SMS_DEV_TO` doctrine)
- [x] `docs/wiki/go-live-accounts.md` — Twilio provisioning runbook entry §6 (owner-driven: account creation, toll-free purchase + verification — flagged, not blocking)
- [x] Unit tests: client env-guard + send redirect matrix (anchor: `src/lib/email/send.test.ts`)

#### Phase 2: Schema — messages, recipients, opt-outs

Shaped by `decision.md` D1–D5 (owner-confirmed 2026-07-13): no campaign flag
(gate = `sms_email > 0`); per-campaign dealer-list import; permanent global
opt-outs; body stored once per launch; recipients hard-deleted at 24 months
with the message ledger surviving (`recipient_id` nullable, `ON DELETE SET NULL`,
phone snapshotted on the message).

- [x] `src/lib/db/schema/sms-recipients.ts` — per-campaign imported dealer list: campaign FK, phone (E.164, CHECK-guarded), name, consent basis enum (`express` / `implied_purchase` / `implied_inquiry`), `last_contact_at`; unique `(campaign_id, phone)`; `created_at` index for the retention purge
- [x] `src/lib/db/schema/sms-sends.ts` — one row per launch: campaign FK (RESTRICT), body (the template, stored once — D5), exclusion-count snapshot (`total_recipients` / `excluded_opt_out` / `excluded_stale_consent`); launch actor via `created_by_id`
- [x] `src/lib/db/schema/sms-messages.ts` — the permanent ledger: send FK (RESTRICT), nullable recipient FK (`ON DELETE SET NULL`), snapshotted phone, Twilio SID (unique, partial), status enum (`queued`/`sent`/`delivered`/`undelivered`/`failed`), error code, status timestamps; no `actors` (machine rows)
- [x] `src/lib/db/schema/sms-opt-outs.ts` — permanent: phone (unique), opted-out-at, source (`stop_reply` / `manual`), inbound SID evidence
- [x] Register all four in `schema/index.ts`; migration `drizzle/0049_unusual_timeslip.sql` generated + applied to sandbox (session pooler 5432; journal `when` monotonic verified; tables + CHECKs + partial unique verified via psql)
- [x] Test case: `tests/integration/sms-schema.test.ts` — 6 cases: round-trip chain, purge → SET-NULL ledger survival, global opt-out unique, cross-campaign duplicate allowed / in-campaign rejected, E.164 CHECK rejection, status-enum lifecycle

#### Phase 3: Compose + launch Server Actions
- [x] `sms:send` capability (pure-admin, D4) in `src/lib/auth/capabilities.ts`
- [x] `src/lib/sms/template.ts` — `renderSmsBody` personalization (`{{first_name}}` / `{{last_name}}` / `{{dealer_name}}`; missing → ''; unknown variable left verbatim)
- [x] `src/features/sms/eligibility.ts` — pure CASL predicate (D3 fixed windows: purchase 24mo, inquiry 6mo, express never; opt-out beats express; missing last-contact on implied basis = stale)
- [x] `src/features/sms/import-csv.ts` — CSV row parser + zod row schema + E.164 phone normalization (+1 default; keep-first in-file dedupe; all-or-nothing row validation)
- [x] `src/features/sms/actions.ts` — `importSmsRecipients` (wholesale replace of the campaign list), `launchSmsSend` (D1 gate `sms_email > 0`, booked-only, opt-out + staleness exclusion, tx-created send + message rows then per-row dispatch, auto STOP footer), `addSmsOptOut` (manual source, idempotent)
- [x] `src/features/sms/queries.ts` — `evaluateCampaignRecipients` (shared by preview + launch so they can't disagree), `loadSmsSendLog`, `loadSmsCampaignContext`
- [x] `scripts/purge-sms-recipients.ts` — D5 retention purge (dry-run default, `--delete` to purge; recipients ≥ 24 months old; ledger survives via SET NULL)
- [x] `audit_action` enum + `AuditActionId` gained `sms.recipients_imported` / `sms.launched` / `sms.opt_out_recorded` (migration `0050`, applied to sandbox)
- [x] Test case: eligibility predicate unit matrix (bases × windows × opt-out × boundary day × missing dates) — `eligibility.test.ts`
- [x] Test case: template rendering + CSV import parsing/normalization units — `template.test.ts`, `import-csv.test.ts` (DB-level launch flow lands in Phase 6 integration)

#### Phase 4: Status-callback webhook + STOP opt-out
- [x] `src/lib/sms/webhook-verify.ts` — Twilio `X-Twilio-Signature` verification: base64 HMAC-SHA1 over URL + alphabetically-sorted form params, `timingSafeEqual` compare (no timestamp/replay window in Twilio's scheme — replays are no-ops downstream: monotonic flips + idempotent opt-out)
- [x] `src/lib/sms/webhook-events.ts` — pure classification: status-callback vs inbound message, Twilio→ledger status mapping (`accepted/scheduled/sending`→`queued`; unknown→ignored), monotonic `STATUS_RANK`, STOP-keyword match (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT, whole-message)
- [x] `src/app/api/twilio/webhook/route.ts` — external route handler: raw body read, verify BEFORE any DB touch (URL built from SITE_URL, never request Host), guarded-UPDATE status flip by `provider_sid` (404 on unknown sid so a raced callback retries; 200 on no-forward-transition), inbound STOP → permanent opt-out insert (ON CONFLICT DO NOTHING), 2xx-ack for authentic-but-unrecognized shapes
- [x] Test case: signature verification matrix (valid, tampered param, wrong URL/Host confusion, wrong token, missing header, param-order insensitivity) — `webhook-verify.test.ts`
- [x] Test case: classification + status-mapping + STOP-keyword units — `webhook-events.test.ts` (DB round-trip lands in Phase 6 integration)

#### Phase 5: UI — campaign-detail SMS panel
- [ ] Task 1
- [ ] Task 2
- [ ] Test case 1

#### Phase 6: Tests + smoke verification
- [ ] Service-level integration test for the SMS send path (opt-out exclusion provable against real DB)
- [ ] Verify multi-step operations with real DB (launch → message rows → webhook status flip)
- [ ] Verify transaction rollback on failure
- [ ] Smoke (web-test): `goto` the campaign/event detail route; expect the SMS panel heading + compose/review controls (read-only — do NOT click a real send)
- [ ] (If DB state is needed) `pnpm dlx tsx scripts/sms-service-smoke.ts insert`; run web-test; `... cleanup`
