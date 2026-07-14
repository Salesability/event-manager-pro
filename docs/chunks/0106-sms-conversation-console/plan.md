# SMS Conversation Console — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-14

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — conversation threads + inbound persistence | Done | `add2840` |
| 2: Webhook — capture non-STOP inbound into threads | Done | `c0e69ef` |
| 3: Console UI + staff reply action | Done | `e8798c1` |
| 4: AI-drafted replies (draft-and-approve) | Done | `e853aba` |
| 5: Tests + smoke verification | Pending | - |

Campaign SMS invites replies but the webhook discards everything except STOP — customer replies land in a black hole. This chunk persists inbound replies as conversation threads, surfaces them to staff with a reply path, and layers AI-drafted responses (vision Module 3's draft/review/approve workflow) toward capturing appointment intent. "Done" = a real reply to a campaign send shows up in the console, a staff (or approved-AI-drafted) reply delivers back, and STOP mid-thread provably halts all further outbound. Phase 4 is gated on the autonomous-vs-draft-and-approve owner call in `intent.md` (plan assumes draft-and-approve).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/sms-conversations.ts` (thread + inbound-message tables, or a `direction` extension of `sms_messages`) | `src/lib/db/schema/sms-messages.ts:36` | Same schema family — enums, FK style, audit columns, ledger posture |
| Webhook inbound-persistence branch | `src/app/api/twilio/webhook/route.ts:134` (`handleInbound`) | The exact function being extended — STOP capture is the sibling behavior |
| Inbound classification (thread attribution, intent tagging) | `src/lib/sms/webhook-events.ts:43` (`isStopMessage` + event parsing) | Same layer: pure, unit-testable webhook-payload logic |
| `src/lib/sms/conversations.ts` (attribution + capture persistence — added Phase 2) | `src/features/sms/queries.ts:48` (Executor pattern) | DB-touching capture logic, kept out of the pure webhook-events layer |
| `src/features/sms/conversations/queries.ts` (thread list, thread detail) | `src/features/sms/queries.ts:116` (`loadSmsSendLog`) | Same read-model shape — campaign-scoped Drizzle reads returning typed rows |
| `replyToThread` server action (staff send + AI-draft approve) | `src/features/sms/actions.ts:157` (`launchSmsSend`) | Same layer: `capabilityClient('sms:send')`, zod `safeParse`, opt-out recheck before `sendSms` |
| Console UI (thread list + conversation view) | `src/features/sms/sms-panel.tsx:1` | Same feature's panel — section layout, badge styles, server-action wiring |
| Console route (per-campaign; global inbox if decided) | `src/app/(app)/calendar/[id]/sms/page.tsx:20` | Same gated-page shape — context load, `notFound()` guards |
| `src/lib/ai/draft-sms-reply.ts` (LLM call, campaign-facts-constrained) | *(no existing AI code in repo — new dependency; anchor `src/lib/sms/send.ts:41` for the thin-client + typed-error-result shape; consult the `claude-api` skill at implementation)* | First LLM surface; mirror the vendor-client pattern (env-keyed client, `{ok}\|{error}` result) |

**Conventions referenced:**
- `docs/wiki/sms.md` — existing send/webhook/ledger architecture this extends
- `docs/wiki/data-model.md` + `db-conventions` skill — before any schema/migration work
- `CLAUDE.md` → Conventions — mutations are Server Actions; the webhook route stays external-caller-only

**Overall Progress:** 80% (4/5 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- ~~Phase 4 does not start until the autonomy + disclosure open questions in `intent.md` are answered~~ **Resolved 2026-07-14** ([`decision.md`](decision.md)): D1 draft-and-approve; D2 per-campaign threads, most-recent-send attribution + manual reassign; D3 per-campaign panel only (`sms:send` capability); D4 no disclosure tag on approved drafts

### Phase Checklist

#### Phase 1: Schema — conversation threads + inbound persistence
- [x] Task 1 (decide: new tables vs `direction` column on `sms_messages`; invoke `db-conventions`) — **new tables**: `sms_messages` is the body-less launch ledger (`send_id` NOT NULL); conversations need bodies and don't belong to a launch. `sms_threads` = (campaign, phone) pair per D2, `sms_thread_messages` = per-message with direction + body + provider SID + nullable delivery status (outbound-only, CHECK-enforced) + `ai_drafted` provenance flag
- [x] Task 2 — schema file `src/lib/db/schema/sms-conversations.ts` + `index.ts` export; migration `drizzle/0052_gorgeous_shaman.sql` generated (no auth-schema statements emitted; journal `when` verified increasing) + applied to sandbox DB (verified via `\d`)

#### Phase 2: Webhook — capture non-STOP inbound into threads
- [x] Task 1 (thread attribution rule per intent.md open question) — D2 most-recent-send: `src/lib/sms/conversations.ts` `captureInboundMessage` picks the latest of (existing thread's `last_message_at`, latest launch send in `sms_messages`), so ongoing/reassigned conversations keep winning and a newer campaign send re-attributes; no campaign history → ack-and-ignore (unchanged posture)
- [x] Task 2 (STOP continues to short-circuit: opt-out + thread halt) — STOP path unchanged (permanent opt-out insert first), plus `captureInboundStop` appends the STOP to the phone's most recent thread as evidence (never creates one)
- [x] Test case 1 — `tests/integration/sms-conversations.test.ts`: capture + sid-replay idempotency (no dup row, no unread re-bump), second inbound joins same thread; multi-campaign attribution to most recent send
- [x] Test case 2 — mid-thread STOP writes opt-out AND appends thread evidence; STOP/chatter from unknown number creates no thread (opt-out still lands)

#### Phase 3: Console UI + staff reply action
- [x] Task 1 — `ConversationsPanel` (`src/features/sms/conversations/conversations-panel.tsx`) + read model (`conversations/queries.ts`: `loadCampaignConversations` with unread/opted-out derivation, `loadReassignCandidates` per D2); rendered on `/calendar/[id]/sms` on BOTH gate branches (replies can arrive after the launch gate lapses); actions `replyToThread` / `markThreadRead` / `reassignThread` (+ 2 new `audit_action` enum values, migration `0053`)
- [x] Task 2 (reply action: opt-out recheck + dev-redirect via `sendSms`) — `sendThreadReply` in `src/lib/sms/conversations.ts`: persist-first queued row → dispatch → sid/failed stamp, opt-out recheck before dispatch, replying clears unread; webhook status callback extended to flip thread-reply rows (same monotonic rank)
- [x] Test case 1 — reply round-trip: dev-redirect proven (Twilio addressed at `SMS_DEV_TO`, real recipient in body prefix), persist-first row + actor stamp, status callback flips the thread ledger
- [x] Test case 2 — STOP mid-thread → reply refused before dispatch, no outbound row; reassign candidates = the other campaigns that texted the number

#### Phase 4: AI-drafted replies (draft-and-approve)
- [x] Task 1 (gated on owner call: autonomy + disclosure wording) — resolved D1 (draft-and-approve, nothing sends without a human) + D4 (no disclosure tag on approved drafts); `src/lib/ai/draft-sms-reply.ts` = first LLM surface (Anthropic SDK, `claude-opus-4-8`, env-keyed `ANTHROPIC_API_KEY` with graceful degradation, `{ok}\|{error}` result per the vendor-client anchor, refusal stop-reason handled)
- [x] Task 2 (drafts constrained to campaign facts; approve/edit/discard UI) — prompt states ONLY dealer name + event dates + reply-to-book; hard rules against invented prices/inventory/hours; `draftThreadReply` action (opted-out + no-inbound refusals) fills the reply box, staff edit/discard freely, send rides `replyToThread` with `aiDrafted` provenance (persisted on the message row + audit payload, "AI draft" badge in thread)
- [x] Test case 1 — `src/lib/ai/draft-sms-reply.test.ts`: prompt constrained to campaign facts + transcript rendering
- [x] Test case 2 — result shapes: unset key degrades gracefully (no SDK call), trimmed ok path, refusal → error, empty → error, thrown → error (SDK fully mocked)

#### Phase 5: Tests + smoke verification
- [ ] Service-level integration test for inbound-capture → thread → reply round-trip
- [ ] Verify STOP mid-thread blocks further outbound (integration)
- [ ] Smoke (web-test): `goto /calendar/<id>/sms`; expect conversation section with thread rows + reply affordance
- [ ] (DB state) extend `scripts/sms-service-smoke.ts` (or new `scripts/sms-conversation-smoke.ts`) with `insert` / `cleanup` seeding a thread with inbound + outbound messages
