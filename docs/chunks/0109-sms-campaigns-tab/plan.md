# SMS campaigns tab — move the ledger off event-dialog nav — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _Not started — scaffolded 2026-07-14, queued behind 0108-appointment-booking_

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Campaign-index read model] | Pending | - |
| 2: [Top-level page + list view] | Pending | - |
| 3: [Nav tab] | Pending | - |
| 4: Tests + smoke verification | Pending | - |

The SMS ledger's only door is calendar → event dialog → SMS button — the event dialog acting as a nav hub (the 0104 anti-pattern). This chunk adds a top-level `sms:send`-gated tab listing every SMS-relevant campaign (dealer, dates, add-on/launch state, imported count, last send, unread) with rows linking to the existing `/calendar/<id>/sms` pages. `/messages` stays purely the inbox (owner call 2026-07-14). Done = the full import → launch → replies workflow is runnable without opening the calendar; the dialog's SMS button demotes to a shortcut. Two naming calls pending in intent.md (tab label/route; list-qualification rule).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `loadSmsCampaignIndex` in `src/features/sms/queries.ts` | `loadSmsSendLog` — `src/features/sms/queries.ts:116` | Same file, same layer: `'server-only'` typed read model; the index variant aggregates per-campaign (joins `dealers`, counts recipients/sends/unread threads) instead of per-send |
| Top-level page (route per intent's naming call, e.g. `src/app/(app)/sms/page.tsx`) | `src/app/(app)/messages/page.tsx:17` | The 0107 sibling: `assertCan('sms:send')` + `PageHeader` + one view component over one query call |
| Campaign-list view component in `src/features/sms/` | `QuotesAdmin` — `src/features/quotes/quotes-admin.tsx:37` | The server-loader → client `<DataTable>` consumer pattern for an index of linkable rows with status badges |
| Nav tab in `OPERATIONAL_TABS` | `src/components/app/app-nav.tsx:23` (the 0107 `messages` row with `capability: 'sms:send'`) | Same capability-gating mechanism, adjacent placement |
| (If owner opts to demote/remove the dialog button) SMS button in event dialog | `src/app/(app)/calendar/event-detail.tsx:237` | The existing `<Can capability="sms:send">` block that links to `/calendar/<id>/sms` |

**Conventions referenced:**
- `docs/wiki/auth.md` — capability gating at page (`assertCan`) + nav (tab `capability:`) layers
- `docs/wiki/sms.md` — add-on gate semantics (`booked` + `smsEmail > 0`) and thread/unread derivation the row states must match
- `docs/wiki/conventions.md` — reads for our own UI via server components/actions; no new route handlers

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- Phase 1 blocks on intent.md's naming call (tab label/route) + list-qualification rule — one-line owner answers, get them at un-park

### Phase Checklist

#### Phase 1: [Campaign-index read model]
- [ ] Task 1
- [ ] Task 2

#### Phase 2: [Top-level page + list view]
- [ ] Task 1
- [ ] Task 2
- [ ] Test case 1
- [ ] Test case 2

#### Phase 3: [Nav tab]
- [ ] Task 1
- [ ] Test case 1

#### Phase 4: Tests + smoke verification
- [ ] Service-level integration test for the campaign-index read model (qualification rule + counts)
- [ ] Smoke (web-test): `goto <route>`; expect the page heading + a row for a fixture SMS campaign with dealer/date/state; click the row → lands on `/calendar/<id>/sms`
- [ ] Smoke (web-test): nav shows the new tab next to Messages (gated visible)
- [ ] (If DB state is needed) reuse `scripts/sms-service-smoke.ts insert` / `cleanup`
