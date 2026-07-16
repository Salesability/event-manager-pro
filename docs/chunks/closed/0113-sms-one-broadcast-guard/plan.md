# One broadcast per campaign — SMS launch guard — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-16

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Server-side broadcast gate | Done | `5edf46a` |
| 2: UI "already sent" state | Done | `168d953` |
| 3: Integration tests + smoke | Done | `1152b97` |

Hard-encode the product rule "one broadcast per campaign" into `launchSmsSend`: a campaign with any dispatched message (`sms_messages.provider_sid IS NOT NULL`) refuses further launches, server-side, inside the existing advisory-locked transaction. The UI mirrors it by swapping the composer for an "already sent" state. Fully-failed launches (no sid anywhere) don't count, so a crashed launch can be retried. Done = the two gate integration tests pass and the composer/already-sent swap is smoke-verified.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `campaignHasDispatchedSend(campaignId, tx?)` in `src/features/sms/queries.ts` | `loadSmsSendLog` in the same file | Same layer (sms query module), same campaign-scoped `sms_sends`→`sms_messages` join shape; new helper is an EXISTS-style boolean over `provider_sid IS NOT NULL` |
| Broadcast gate inside `launchSmsSend` | `src/features/sms/actions.ts:207-221` (the 60-second `recentSend` check) | Same transaction, same lock, same early-return `{ error }` shape — the new gate sits directly beside it and must accept the `tx` handle the same way |
| `alreadySent` prop + composer swap in `src/features/sms/sms-panel.tsx` | The `summary.total > 0` branch of the Recipients section, `sms-panel.tsx:140-154` | Same in-panel conditional-state pattern (explanatory `<p>` inside a `Section`), reuses the existing send-log rendering below it |
| `alreadySent` computation in `src/app/(app)/calendar/[id]/sms/page.tsx` | The `gateActive` derivation + gated branch, `page.tsx:42-110` | Same server-component gate-flag pattern; computed alongside the existing `Promise.all` loads and passed down as a serialized prop |
| Gate integration tests in `tests/integration/sms-service.test.ts` | `'rolls back the whole launch transaction when a message row is invalid'` (same file, line 157) | Same harness: real-DB launch-shape test with tagged fixture rows + cleanup; new tests stamp/omit `provider_sid` and assert the second launch's refusal |
| `scripts/0113-broadcast-guard-smoke.ts` (insert/cleanup fixture script) | `scripts/0110-console-polish-smoke.ts` | The real fixture-script pattern (marker-tagged rows, FK-ordered idempotent cleanup) — the plan's original `calendar-clamp-smoke.ts` anchor doesn't exist |

**Conventions referenced:**
- `docs/wiki/sms.md` — launch flow (persist-first, advisory lock, 60s guard); update the Flow section at close to document the one-broadcast gate.
- `CLAUDE.md` → Conventions — mutations stay in the Server Action; no new route handlers.

**Overall Progress:** 100% (3/3 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)

### Phase Checklist

#### Phase 1: Server-side broadcast gate
- [x] Add `campaignHasDispatchedSend(campaignId, tx?)` to `src/features/sms/queries.ts` — true iff any `sms_sends` row for the campaign has a message with `provider_sid IS NOT NULL` (join `sms_sends` → `sms_messages` on `send_id`, `limit 1`)
- [x] In `launchSmsSend`, inside the locked transaction and **before** the 60-second `recentSend` check, refuse when `campaignHasDispatchedSend` is true: `{ error: 'This campaign has already been broadcast — see the send log below. Campaigns send one broadcast.' }`
- [x] Keep the 60-second window + advisory lock unchanged (they cover the just-launched, no-sid-yet gap)
- [x] Update the launch-flow comment block above `launchSmsSend` (actions.ts:155-161) — "a re-launch is a NEW send" is no longer unconditionally true

#### Phase 2: UI "already sent" state
- [x] In `page.tsx`, compute `alreadySent` via `campaignHasDispatchedSend(campaign.id)` alongside the existing `Promise.all` loads and pass it to `<SmsPanel>`
- [x] In `sms-panel.tsx`, when `alreadySent`: replace the Compose section's textarea + button with a notice — "This campaign's broadcast has gone out — see the send log below. One broadcast per campaign." (keep Recipients/Pre-send review visible read-only; Import CSV button disabled with a title explaining why)
- [x] Belt-and-braces: `onLaunch`'s server error path already surfaces via `toast.error` — no client-side duplication of the gate logic beyond the prop

#### Phase 3: Integration tests + smoke
- [x] Test: launch → stamp `provider_sid` on one message row → second `launchSmsSend` returns the already-broadcast error (assert no new `sms_sends` row) — drives the REAL action with Twilio/session/assert-can/next-cache mocked at the file top
- [x] Test: prior send with **zero** `provider_sid` rows (simulated failed launch) → new launch succeeds
- [x] Test: `campaignHasDispatchedSend` false for a campaign with no sends at all (+ flips true once a sid lands, same rolled-back tx)
- [x] Run serially per pooler-flake posture: `vitest run tests/integration/sms-service.test.ts --no-file-parallelism` — 8/8 pass
- [x] Smoke (web-test): `goto /calendar/<fixture-id>/sms` on a fresh gated campaign; expect section "Compose" with button `Launch send`
- [x] Smoke (web-test): after fixture stamps a dispatched send (`scripts/0113-broadcast-guard-smoke.ts insert` — tagged rows, `cleanup` subcommand, per `scripts/calendar-clamp-smoke.ts` pattern), reload; expect the already-sent notice and **no** `Launch send` button — note: the named anchor `scripts/calendar-clamp-smoke.ts` doesn't exist; the script follows `scripts/0110-console-polish-smoke.ts` (the real fixture-script pattern). Insert seeds BOTH campaigns (fresh + broadcast) in one run; smoke 5/5 PASS
- [x] Close-out: ingest the gate into `docs/wiki/sms.md` Flow section + `log.md` entry
