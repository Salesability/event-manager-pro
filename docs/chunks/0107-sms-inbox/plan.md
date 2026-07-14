# Global SMS Messages inbox — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-14

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Inbox read model + badge count query] | In Progress | - |
| 2: [/messages page + in-place master–detail inbox view] | Pending | - |
| 3: [Nav tab + live unread badge] | Pending | - |
| 4: Tests + smoke verification | Pending | - |

SMS conversations (0106) are only reachable per-event, so inbound replies — and soon, AI reply approvals — can sit unseen; the owner's constraint is that approvals **cannot be missed**. This chunk adds the global surface — **admin-only to start** (owner call; gate on `sms:send`, which is pure-admin per 0103 D4 — if that capability is ever widened, the inbox gate gets its own review, see intent.md): a `Messages` nav tab with a live unread badge, and a `/messages` page listing threads across all campaigns needs-action-first, opening each conversation **in place** (master–detail; owner call 2026-07-14 — this is the surface the upcoming approval queue lands in, so no link-out interim). Reading/replying reuses the 0106 conversation panel internals — shared code, not a fork; the per-event `/calendar/<id>/sms` page is unchanged. Done = tab + badge visible app-wide and updating within ~a minute, threads readable/answerable from `/messages`, unread state clearing on read/reply.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `loadSmsInbox` / `loadInboxUnreadCount` in `src/features/sms/conversations/queries.ts` | `loadCampaignConversations` — `src/features/sms/conversations/queries.ts:40` | Same file, same read-model shape (threads + unread derivation from `last_inbound_at`/`last_read_at`); the inbox variant drops the `campaignId` filter and joins `campaigns`/`dealers` for row context |
| `src/app/(app)/messages/page.tsx` | `src/app/(app)/dealerships/pipeline/page.tsx:12` | Same layer: top-level read-only aggregate page — `assertCan` + `PageHeader` + a single view component over one query call (gate is `sms:send`, not `admin:access`) |
| `src/features/sms/conversations/inbox-view.tsx` | `src/features/sms/conversations/conversations-panel.tsx` | Same directory + same data shape (thread list → conversation); the inbox view should **reuse** the panel's thread/reply internals, not fork them |
| `Messages` tab in `OPERATIONAL_TABS` | `src/components/app/app-nav.tsx:23` (see the `quotes` row's `capability: 'quote:edit'` at `:31`) | Capability-gated top-level tab — same `capability:` mechanism, gated `sms:send` |
| Unread-badge client component in `src/components/app/` | `src/components/app/app-nav.tsx:66` | Same directory, same layer (client component under the header); polls a read action on an interval and renders the count pill on the Messages tab |
| Badge-count read action in `src/features/sms/actions.ts` | `markThreadRead` — `src/features/sms/actions.ts:454` | Same file, same `capabilityClient('sms:send')` wrapper shape — reads via Server Action per the mutations/UI convention (route handlers are external-callers-only) |

**Conventions referenced:**
- `docs/wiki/sms.md` — thread/read-pointer model (`last_inbound_at` / `last_read_at` unread derivation), opt-out semantics the inbox rows must respect
- `docs/wiki/auth.md` — capability gating (`sms:send`) at page (`assertCan`) + nav (tab `capability:`) + action (`capabilityClient`) layers
- `docs/wiki/conventions.md` — Server Actions for anything our own UI triggers; no new route handlers

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)

### Phase Checklist

#### Phase 1: [Inbox read model + badge count query]
- [x] `loadSmsInbox` in `src/features/sms/conversations/queries.ts` — all-campaign thread list joined to `campaigns`/`dealers` for row context (dealer name + event dates), unread derivation from `last_inbound_at`/`last_read_at`, opt-out flags, bounded recent messages, needs-action-first sort (unread first, then recency)
- [x] `loadInboxUnreadCount` in the same file — single count of threads with unread inbound (`last_inbound_at > coalesce(last_read_at, -infinity)`)

#### Phase 2: [/messages page + inbox view]
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Test case 1
- [ ] Test case 2
- [ ] Test case 3

#### Phase 3: [Nav tab + live unread badge]
- [ ] Task 1
- [ ] Task 2
- [ ] Test case 1
- [ ] Test case 2

#### Phase 4: Tests + smoke verification
- [ ] Service-level integration test for the inbox read model
- [ ] Verify multi-step operations with real DB
- [ ] Smoke (web-test): `goto /messages`; expect heading "Messages" + thread rows with dealer/event context; click a row → conversation renders in place (master–detail) with a reply box (fixture-dependent)
- [ ] Smoke (web-test): `goto /calendar`; nav shows a `Messages` tab (badge count fixture-dependent)
- [ ] (If DB state is needed) `pnpm dlx tsx scripts/0107-sms-inbox-smoke.ts insert`; run web-test; `... cleanup`
