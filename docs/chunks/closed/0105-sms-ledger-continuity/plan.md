# SMS Ledger Continuity — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-13
**Branch note:** built on `0103-sms-service` (unmerged), by owner instruction — merges with the base chunk in one deploy; migrations 0049–0051 apply to prod together.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema + identity lib (migration 0051; `identity_hmac` on recipients, consent/contact/hmac snapshot columns on messages; `src/lib/sms/identity.ts` + env/secret) | Done | `5f6d12c` |
| 2: Stamp + surface (import stamps recipients; launch snapshots messages; dealer-scoped history query; pre-send review badges) | Done | `63a470d` |
| 3: Tests + smoke + eval | Done | `a4ac7b6` + fixes `4395c1c` |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/sms/identity.ts` | `src/lib/crypto/sealed-box.ts` | Existing keyed-crypto module shape (env-keyed secret, base64 key handling, pure + unit-tested) |
| Migration 0051 (ALTER TABLE adds) | `drizzle/0050_acoustic_rafael_vega.sql` | Additive, nullable columns — no backfill (tables are sandbox-only) |
| History query | `src/features/sms/queries.ts` `loadSmsSendLog` | Same layer; dealer scope via `sms_sends → campaigns.dealer_id` join |
| Review badges | `src/features/sms/sms-panel.tsx` pre-send review section | Extends the existing excluded-list rendering |
| Launch snapshot | `src/features/sms/actions.ts` `launchSmsSend` tx insert | The message-row `values()` map gains three snapshot fields |

**Overall Progress:** 100% (3/3 phases complete)

_Checklists below were executed as written; deviations worth noting: the launch-evaluation move into the locked transaction + the key-versioned fingerprint format landed as eval fixes (`4395c1c`, see `eval-2026-07-13-1111.md`) rather than as original phase items._

### Phase Checklist

#### Phase 1: Schema + identity lib
- [x] `src/lib/db/schema/sms-recipients.ts` — add `identity_hmac` text (nullable)
- [x] `src/lib/db/schema/sms-messages.ts` — add `consent_basis` (`sms_consent_basis`, nullable), `last_contact_at` date (nullable), `identity_hmac` text (nullable) — send-event snapshots that survive the purge (intent §outcome)
- [x] Migration `0051` generated + applied to sandbox (journal `when` monotonic)
- [x] `src/lib/sms/identity.ts` — `computeIdentityHmac({firstName,lastName,phone})`: normalize (trim, lowercase, collapse whitespace), HMAC-SHA256 hex keyed on `SMS_IDENTITY_HMAC_KEY`; unset key → null (graceful degrade)
- [x] `.env.example` — `SMS_IDENTITY_HMAC_KEY` block (openssl rand -base64 32; verification-only rationale)
- [x] `docs/wiki/go-live-accounts.md` — add the key to the Twilio §6 developer-side secrets
- [x] Unit tests: determinism, name-change divergence, phone inclusion, missing-key null, normalization equivalences

#### Phase 2: Stamp + surface
- [x] `importSmsRecipients` stamps `identity_hmac` per row
- [x] `launchSmsSend` snapshots `consent_basis` / `last_contact_at` / `identity_hmac` onto each message row at tx-insert
- [x] `queries.ts` — `loadRecipientHistory(campaignId)` (or fold into `evaluateCampaignRecipients` call site): for the campaign's recipients' phones, dealer-scoped prior-message aggregates (count, last status, last sent-at, latest historical `identity_hmac`)
- [x] Panel: per-recipient history badges in pre-send review (texted-before count + last outcome; identity `matches` / `differs` / `—`)
- [x] Page: thread history data through `/calendar/[id]/sms`

#### Phase 3: Tests + smoke + eval
- [x] Integration: snapshot columns survive recipient delete (extend `sms-schema.test.ts` D5 case); history query returns dealer-scoped aggregates + identity match verdict against seeded prior sends
- [x] Smoke: fixture gains a prior-dealer send with matching + differing hashes; review shows badges (read-only)
- [x] `decision.md`: PIPEDA posture note (verification-only keyed hash, why retained)
- [x] Chunk-end `/eval`
