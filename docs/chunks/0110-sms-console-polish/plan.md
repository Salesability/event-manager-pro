# SMS console polish — names, turn-state, quick replies, funnel strip, sentiment — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-15

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Schema — thread display name + sentiment/temperature columns] | Pending | - |
| 2: [Names + turn-state in console/inbox read models + UI] | Pending | - |
| 3: [Quick-reply chips in the composer] | Pending | - |
| 4: [Funnel stat strip on the Campaign SMS page] | Pending | - |
| 5: [Sentiment + prospect-temperature classifier + dots/badges] | Pending | - |
| 6: Tests + smoke verification | Pending | - |

Competitor-review polish (owner call 2026-07-15) before the SMS line's stage review: threads lead with customer names (purge-safe snapshots), a turn-state label replaces guessing who owes a reply, canned quick-reply chips sit beside the AI Draft button, the Campaign SMS page opens with a Sent/Delivered/Responses/No-response/Stops strip, and each thread gets a display-only sentiment dot + hot/warm/cold prospect badge classified from the customer's messages. Done = the console/inbox/`/sms` surfaces show all five, with graceful degradation when `ANTHROPIC_API_KEY` is unset and zero change to the human-in-the-loop reply flow.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `display_name` + `sentiment` + `prospect_temperature` columns on `sms_threads` | `src/lib/db/schema/sms-conversations.ts:27` (the table + header comment) | Same file; nullable denormalized columns stamped by writers, like the `last_*` family. Invoke the `db-conventions` skill first (migration `0056`; journal `when` gotcha; backfill of existing threads' names is small-table in-migration SQL) |
| Thread-creation name snapshot | `src/lib/sms/conversations.ts:72` (the `insert(smsThreads)` in inbound capture) | The one writer that creates threads — stamp `display_name` there from the campaign+phone recipient lookup; also re-stamp on reassign (the other campaign's list may name them differently) |
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

**Overall Progress:** 0% (0/6 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- Phase 5 blocks on the intent's open question (auto-classify on inbound = the app's first autonomous LLM call — owner blessing required; fallback = classify on page load / on demand)

### Phase Checklist

#### Phase 1: [Schema — thread display name + sentiment/temperature columns]
- [ ] Task 1
- [ ] Task 2

#### Phase 2: [Names + turn-state in console/inbox read models + UI]
- [ ] Task 1
- [ ] Task 2
- [ ] Test case 1

#### Phase 3: [Quick-reply chips in the composer]
- [ ] Task 1
- [ ] Test case 1

#### Phase 4: [Funnel stat strip on the Campaign SMS page]
- [ ] Task 1
- [ ] Task 2
- [ ] Test case 1

#### Phase 5: [Sentiment + prospect-temperature classifier + dots/badges]
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Test case 1
- [ ] Test case 2

#### Phase 6: Tests + smoke verification
- [ ] Service-level integration test: thread name snapshot survives recipient purge; turn-state + funnel numbers reconcile with seeded fixtures
- [ ] Smoke (web-test): `goto /messages` (authed) — fixture thread shows the customer NAME, turn-state label, sentiment dot + temperature badge
- [ ] Smoke (web-test): `goto /calendar/<fixture-id>/sms` — funnel strip chips Sent / Delivered / Responses / No response / Stops with fixture-reconciled numbers; quick-reply chip click fills the reply box (no send)
- [ ] Smoke (web-test): `goto /sms` — row shows aggregate sentiment/temperature counts (if Phase 5 lands them there)
- [ ] `pnpm dlx tsx scripts/0110-console-polish-smoke.ts insert`; run web-test; `... cleanup`
