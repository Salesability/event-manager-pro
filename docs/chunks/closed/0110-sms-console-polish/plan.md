# SMS console polish — names, turn-state, quick replies, funnel strip, sentiment — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-15

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Schema — thread display name + sentiment/temperature columns] | Done | `19fe801` |
| 2: [Names + turn-state in console/inbox read models + UI] | Done | `7d8446b` |
| 3: [Quick-reply chips in the composer] | Done | `f4c2618` |
| 4: [Funnel stat strip on the Campaign SMS page] | Done | `18b6774` |
| 5: [Sentiment + prospect-temperature classifier + dots/badges] | Done | `a8550cd` |
| 6: Tests + smoke verification | Done | `9df5157` |

Competitor-review polish (owner call 2026-07-15) before the SMS line's stage review: threads lead with customer names (purge-safe snapshots), a turn-state label replaces guessing who owes a reply, canned quick-reply chips sit beside the AI Draft button, the Campaign SMS page opens with a Sent/Delivered/Responses/No-response/Stops strip, and each thread gets a display-only sentiment dot + hot/warm/cold prospect badge classified from the customer's messages. Done = the console/inbox/`/sms` surfaces show all five, with graceful degradation when `ANTHROPIC_API_KEY` is unset and zero change to the human-in-the-loop reply flow.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `display_name` + `sentiment` + `prospect_temperature` columns on `sms_threads` | `src/lib/db/schema/sms-conversations.ts:27` (the table + header comment) | Same file; nullable denormalized columns stamped by writers, like the `last_*` family. Invoke the `db-conventions` skill first (migration `0056`; journal `when` gotcha; backfill of existing threads' names is small-table in-migration SQL) |
| Thread-creation name snapshot | `src/lib/sms/conversations.ts:72` (the `insert(smsThreads)` in inbound capture) | The one writer that creates threads — stamp `display_name` there from the campaign+phone recipient lookup; also re-stamp on reassign (the other campaign's list may name them differently). Built: `lookupThreadDisplayName` in `src/lib/sms/conversations.ts`, reassign re-stamp in `src/features/sms/actions.ts` (keeps old snapshot when target list lacks the number) |
| Turn-state derivation | `unread` derivation — `src/features/sms/conversations/queries.ts:190` | Same read-model derivation style; turn-state = last message direction (denormalized `last_*` compare or last-message lookup, match whichever the query already has in hand) |
| Quick-reply chips row | Draft-button wiring in `src/features/sms/conversations/conversations-panel.tsx` (the reply box + "Draft AI reply") | Same component, same "fills the box, staff edit/send" contract; chips are a `const` list module (`src/features/sms/quick-replies.ts`) so tests import it without the client component |
| Funnel stat strip | `SmsPanel` summary chips — `src/features/sms/sms-panel.tsx:129` (Recipients section) + `loadSmsCampaignIndex` aggregates — `src/features/sms/queries.ts` (0109) | Same aggregate-read shape; the strip is a server-computed read model rendered as header chips (Badge vocabulary per `docs/wiki/layout.md`) |
| `src/lib/ai/classify-sms-thread.ts` (sentiment + temperature, one call) | `src/lib/ai/draft-sms-reply.ts` | The repo's LLM-boundary pattern: bounded untrusted transcript, hard output contract (here: a closed enum pair, not prose), graceful no-key degradation, refusal handling |
| Classifier trigger on inbound | webhook inbound capture — `src/lib/sms/conversations.ts` (post-commit, best-effort) | Non-blocking side effect after the ledger write, like the existing thread bookkeeping; must never fail the webhook (⚠ blocked on the intent's owner call — see Open questions) |
| Sentiment dot + temperature badge UI | unread/opted-out badges — `src/features/sms/conversations/inbox-thread-list.tsx:52` | Same badge row, same hook-free testability |

**Conventions referenced:**
- `db-conventions` skill — invoke before schema/migration work (migration `0056`; backfill pattern)
- `docs/wiki/sms.md` — thread model, unread derivation, AI-boundary rules (bounded transcript, no invented facts), purge posture the name snapshot must respect
- `docs/wiki/layout.md` — Badge/status vocabulary for dots, temperature, and strip chips
- `docs/wiki/conventions.md` — mutations/reads via Server Actions and server components

**Overall Progress:** 100% (6/6 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- ~~Phase 5 blocks on the intent's open question~~ Resolved 2026-07-15: owner blessed auto-classify on inbound ([`decision.md`](decision.md) D1)

### Phase Checklist

#### Phase 1: [Schema — thread display name + sentiment/temperature columns]
- [x] Add `display_name` (text, nullable snapshot), `sentiment` (pgEnum positive/neutral/negative), `prospect_temperature` (pgEnum hot/warm/cold), and `classified_at` (timestamptz — staleness marker vs `last_inbound_at`, needed by either Phase 5 trigger shape) to `sms_threads`
- [x] Generate migration `0056` (`pnpm db:generate`), verify journal `when` monotonic, append in-migration backfill of `display_name` for existing threads from `sms_recipients` (campaign_id, phone) join (small table)
- [x] Apply to sandbox (`pnpm db:migrate`) — columns verified; backfill no-op (no threads on sandbox)

#### Phase 2: [Names + turn-state in console/inbox read models + UI]
- [x] Stamp `display_name` at thread creation (`resolveThread` insert) via a recipient-lookup helper (`lookupThreadDisplayName`); re-stamp on reassign only when the target campaign's list names the number (keep the old snapshot when it doesn't — purge-safe)
- [x] Read models: `displayName` + `awaitingReply` (turn-state = last-message direction, derived `last_inbound_at >= last_message_at`) in `loadCampaignConversations` + `loadSmsInbox`; serialize through both pages
- [x] UI: console thread header + inbox rows lead with the name (fallback phone, phone stays visible as secondary), turn-state badge ("awaiting your reply" amber / "waiting on customer" zinc), suppressed on opted-out threads
- [x] Test case: inbox-thread-list render test covers name-first rows, phone fallback, and turn-state labels

#### Phase 3: [Quick-reply chips in the composer]
- [x] `src/features/sms/quick-replies.ts` — curated const list (8 `{label, body}` chips, competitor-derived; owner prunes in review); chips row in the composer (tap → fills the box verbatim, clears the AI-draft provenance flag, staff edit/send as usual; pill idiom per layout.md)
- [x] Test case: quick-replies module invariants (count, unique labels, SMS-sized bodies, no template vars — replies don't run the renderer)

#### Phase 4: [Funnel stat strip on the Campaign SMS page]
- [x] `loadSmsCampaignFunnel` read model in `src/features/sms/queries.ts` — Sent (all attempted message rows, = send-log status sum), Delivered (`status='delivered'`), Responses (threads with any inbound — the intent's stated leaning; STOP-only replies count as both a response and a stop), No response (distinct messaged phones − responses, floored), Stops (opted-out numbers among messaged phones)
- [x] `src/features/sms/funnel-strip.tsx` hook-free strip (Badge chips), rendered at the top of `/calendar/[id]/sms` on BOTH gate branches (hidden until there's something to count — `sent > 0 || responses > 0`)
- [x] Test case: funnel-strip render test (labels + numbers)

#### Phase 5: [Sentiment + prospect-temperature classifier + dots/badges]
- [x] ~~Owner call on the trigger~~ **resolved 2026-07-15: auto-classify on inbound blessed** — see [`decision.md`](decision.md) D1
- [x] `src/lib/ai/classify-sms-thread.ts` — one call returns the closed enum pair (strict JSON → Zod), bounded untrusted transcript, graceful no-key/refusal/malformed degradation, webhook-safe client timeout + no retries (Haiku — per-inbound cost, not drafting quality)
- [x] `classifyThreadFromInbound` writer (stamps `sentiment`/`prospect_temperature`/`classified_at`) + webhook post-commit trigger on non-STOP inbounds — best-effort, never fails the webhook
- [x] Read models + UI: sentiment dot (green/zinc/red) + temperature badge (hot/warm/cold) in console threads + inbox rows (`thread-signals.tsx`); hot/warm/cold aggregate counts on the `/sms` tab index
- [x] Test case: classifier unit tests (prompt contract, no-key, valid/malformed output, refusal, thrown error)
- [x] Test case: UI render tests (dot + badge in inbox rows; index aggregates)

#### Phase 6: Tests + smoke verification
- [x] Service-level integration test (`tests/integration/sms-console-polish.test.ts`, 5 tests): name snapshot survives recipient purge; null name for off-list numbers; turn-state flips both ways; classifier stamp (SDK mocked) + funnel numbers reconcile with seeded fixtures; classifier failure never blocks capture. Also fixed sms-conversations/sms-service integration tests to clear `ANTHROPIC_API_KEY` (the 0110 webhook trigger would otherwise make REAL Anthropic calls from tests)
- [x] Smoke (web-test): `goto /messages` (authed) — fixture thread shows "Sarah Smoketest", "awaiting your reply", sentiment dot + "hot prospect" badge (`/tmp/web-test-0110-messages.png`)
- [x] Smoke (web-test): `goto /calendar/3643/sms` — funnel strip reads exactly 3 sent / 2 delivered / 1 response / 2 no response / 1 stops (fixture-reconciled); "Ask for a time" chip click filled the reply box, no send (`/tmp/web-test-0110-campaign-sms.png`)
- [x] Smoke (web-test): `goto /sms` — fixture row shows "1 hot" aggregate + "1 new reply" (`/tmp/web-test-0110-sms-index.png`)
- [x] `pnpm dlx tsx scripts/0110-console-polish-smoke.ts insert`; web-test run; cleanup deferred until after the chunk-end `/eval` browser pass reuses the fixtures
