# One broadcast per campaign — SMS launch guard — Intent

**Created:** 2026-07-16

## Problem

"Launch send" texts every eligible recipient on a campaign's list — typically a few hundred to low thousands of real customer phones. Product reality is **one broadcast per campaign**, but the code only enforces a 60-second duplicate window (plus an advisory lock for racing requests). Sixty-one seconds after a launch, the button behaves exactly like a first send: same one-click confirm, full re-blast. An accidental second launch (muscle-memory confirm click, a stale tab, "did that go out?" retry) double-texts the entire list — a large, unrecoverable, customer-facing blast radius with CASL optics attached.

## Desired outcome

A campaign that has already broadcast **cannot** be launched again — enforced server-side, not just in the UI.

- `launchSmsSend` refuses when the campaign already has a send with at least one **dispatched** message (a `sms_messages` row with a `provider_sid`). The refusal message points at the send log.
- A prior launch that never reached Twilio (crashed pre-dispatch, every create failed — the 0103-a orphan shapes) does **not** count as the campaign's broadcast, so a fully-failed launch doesn't permanently brick the campaign.
- The UI reflects the same truth: when the campaign has a dispatched send, the Compose section is replaced by an "already sent" state pointing at the send log, so the operator never sees a live "Launch send" button they can't legitimately use.
- The existing 60-second window + advisory lock stay — they still cover the gap where a just-launched send hasn't stamped any `provider_sid` yet.

## Non-goals

- **No resend/override flow.** If a legitimate second broadcast is ever needed, that's a deliberate product decision for a future chunk (e.g. an admin override with typed confirm) — not a flag smuggled in here.
- **No durable-dispatch rework.** The outbox/worker + launch-in-progress lock remain parked as 0103-a; this chunk only closes the *re-blast* hole, not the crash-mid-dispatch orphan rows.
- **No changes to the thread-reply path** (`sendThreadReply`) — one-to-one console replies are unaffected.
- **No schema change.** `provider_sid IS NOT NULL` on `sms_messages` already encodes "dispatched"; no new status column.

## Success criteria

- Integration test: launch succeeds → stamp a `provider_sid` on one of its message rows → second launch is refused with the already-broadcast error.
- Integration test: a prior send whose messages all lack `provider_sid` does **not** block a new launch.
- UI: a campaign with a dispatched send renders the send log + an "already sent" notice instead of the composer; a fresh campaign still shows the composer.
- The gate runs inside the same advisory-locked transaction as the existing checks (no TOCTOU window against a concurrent launch).

## Open questions

- None blocking — the "dispatched = any `provider_sid`" definition was settled at scaffold time.

## Why now

The SMS line is staged and on the prod runway (migrations 0049–0056 + toll-free verification pending). Closing the double-blast hole before real customer sends begin is materially cheaper than after the first incident.
