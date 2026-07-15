# Global SMS Messages inbox — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-14

> **Paused 2026-07-14 (owner call), un-parked 2026-07-15:** all 4 phases were implemented, committed, and smoke-verified before the pause; the chunk-end `/eval` was aborted mid-run during the SMS-AI rethink. **Un-park trigger fired 2026-07-15** — the business settled on exactly this surface (inbox + human-in-the-loop AI-suggested replies), so the chunk-end `/eval` re-ran for the close-out gate (see the dated eval report in this folder).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Inbox read model + badge count query] | Done | c0be5e4 |
| 2: [/messages page + in-place master–detail inbox view] | Done | 1e2bab0 |
| 3: [Nav tab + live unread badge] | Done | 0d47bf5 |
| 4: Tests + smoke verification | Done | e3542d1 |

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

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)

### Phase Checklist

#### Phase 1: [Inbox read model + badge count query]
- [x] `loadSmsInbox` in `src/features/sms/conversations/queries.ts` — all-campaign thread list joined to `campaigns`/`dealers` for row context (dealer name + event dates), unread derivation from `last_inbound_at`/`last_read_at`, opt-out flags, bounded recent messages, needs-action-first sort (unread first, then recency)
- [x] `loadInboxUnreadCount` in the same file — single count of threads with unread inbound (`last_inbound_at > coalesce(last_read_at, -infinity)`)

#### Phase 2: [/messages page + inbox view]
- [x] Export `ConversationThread` (+ `ConversationThreadData` type) from `conversations-panel.tsx` — shared internals for the inbox detail pane, not a fork
- [x] `src/features/sms/conversations/inbox-view.tsx` + `inbox-thread-list.tsx` — client master–detail: hook-free `InboxThreadList` in its own module (dealer/event/phone context, unread badge + bold, last-message preview; separate file so the node-env test avoids the server-only actions import) + detail pane rendering the shared `ConversationThread`; opening an unread thread fires `markThreadRead` (read-on-open); no default selection so nothing is auto-marked read
- [x] `src/app/(app)/messages/page.tsx` — `assertCan('sms:send')` + `loadSmsInbox` + serialization (ISO dates, per-thread reassign candidates) + `PageHeader` + `SmsInboxView`
- [x] Add `/messages` to `revalidateSmsViews()` so reply/mark-read/reassign refresh the inbox
- [x] Test: list rows render dealer/event/phone context, unread + opted-out badges, last-message preview
- [x] Test: outbound preview gets the `You: ` prefix; empty thread renders no preview
- [x] Test: selected row carries `aria-current`

#### Phase 3: [Nav tab + live unread badge]
- [x] `getInboxUnreadCount` read action in `src/features/sms/actions.ts` — `capabilityClient('sms:send')`, returns `{ ok, count }` (`// validation: skip` — no input)
- [x] `Messages` tab in `OPERATIONAL_TABS` (`capability: 'sms:send'`) + badge rendered inside the tab link
- [x] `src/components/app/messages-unread-badge.tsx` (polls the action every 45s + on every route change) + hook-free `unread-count-pill.tsx` (red pill, hidden at 0, 99+ cap)
- [x] Test: pill renders count + aria-label
- [x] Test: pill hidden at zero; display caps at 99+

#### Phase 4: Tests + smoke verification
- [x] Service-level integration test for the inbox read model — `tests/integration/sms-inbox.test.ts` (phone prefix `+1999557`): cross-campaign aggregation + dealer/event context joins + needs-action-first sort + opted-out flag
- [x] Verify multi-step operations with real DB — unread-count lifecycle (outbound-only → inbound → read → new inbound), delta-based so the shared sandbox DB can't skew it
- [x] Smoke (web-test): `goto /messages` — heading "Messages" + thread rows with dealer/event context ✓; click a row → conversation renders in place (master–detail) with reply box + Draft AI reply ✓; read-on-open cleared the row's "new reply" badge ✓
- [x] Smoke (web-test): `goto /calendar` — nav shows the `Messages` tab ✓; badge re-polled on route change and dropped 2 → 1 after the read ✓
- [x] ~~`pnpm dlx tsx scripts/0107-sms-inbox-smoke.ts insert`~~ — reused the existing 0106 fixture (`scripts/sms-service-smoke.ts insert`/`cleanup`) instead; it already seeds conversation threads and no inbox-specific state was needed
