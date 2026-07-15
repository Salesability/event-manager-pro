# Global SMS Messages inbox — Intent

**Created:** 2026-07-14

## Problem

SMS conversations (0106) are only reachable per-event at `/calendar/<id>/sms` — three clicks deep, and only if you already know *which* event has activity. Inbound customer texts arrive on the customer's schedule, not while the right event dialog happens to be open, so replies sit unseen. This gets worse, not better: the next step on the autonomous-conversation path is an AI reply **approval queue**, and the owner's constraint is explicit — *reply approvals cannot be missed*. There is currently no surface in the app where "something needs a reply/approval" is visible globally. A side effect of the current shape is that the event dialog has drifted toward being a navigation hub; the intent (0104) is that it's a workflow-*completion* hub.

## Desired outcome

- A top-level **Messages** page aggregating SMS threads across all campaigns, sorted needs-action-first (unread inbound on top, then by recency), each row carrying dealer/event context and opening the conversation for reading + reply.
- A persistent **unread badge** on the Messages nav item, visible from every page in the app, updating without a manual reload (lightweight polling is fine).
- The per-event SMS page stays as-is for event-scoped work (import / launch / that event's threads); the event dialog sheds no functionality but stops being the only door to conversations.
- The surface is deliberately shaped so the upcoming approval queue (AI-drafted replies pending human approval) can land in it as a new needs-action row type + badge contribution, not a new page.

## Non-goals

- **The approval queue itself** — AI auto-drafting on inbound, pending-approval state, approve/send flow. That's the next chunk; this chunk builds the surface it lands in.
- **Auto-send / autonomous replies** — further along the crawl→walk→run path (PIPEDA call pending).
- **Escalation notifications** (email/SMS to staff when something sits unactioned > N minutes) — rides with the approval-queue chunk, where the "cannot be missed" stakes actually begin.
- **Per-user read state** — `sms_threads.last_read_at` is a single global read pointer (0106 v1); this chunk inherits it, not fixes it.
- **Event-dialog restructuring** — returning the dialog to workflow-completion shape is a separate design conversation; this chunk only removes the "only door" pressure.

## Success criteria

- A `Messages` tab appears in the app nav for users with `sms:send`, badge showing the count of threads with unread inbound; badge updates within ~a minute of a new inbound landing (no manual reload).
- `/messages` lists every thread across campaigns with dealer name + event date context; unread threads sort first and are visually distinct.
- Opening a thread from `/messages` allows reading the full conversation and sending a reply (same reply/draft/opt-out behavior as the per-event console — shared code, not a fork).
- Replying or opening an unread thread clears its unread state and the badge count drops accordingly.
- The per-event `/calendar/<id>/sms` surface is unchanged in behavior.

## Open questions

_All resolved 2026-07-14 (owner call):_

- ~~In-place vs link-out?~~ **In-place master–detail** on `/messages` — it's the surface the approval queue needs; the conversation panel component already exists to embed.
- ~~Badge refresh mechanism?~~ Default taken: small client component polling a `capabilityClient` read action on an interval.
- ~~Per-coach thread filtering?~~ **Admin-only to start** (owner call 2026-07-14). Gating on `sms:send` delivers this today because `sms:send` is a pure-admin capability (0103 D4) — but the admin-only posture is the *intent*, not an accident of the capability mapping. If `sms:send` is ever widened (e.g. coaches replying to their own events' threads), the global inbox gate must be revisited on its own — it exposes every campaign's conversations, so it doesn't automatically follow the capability.

## Why now

0106 shipped the conversation console and the owner has chosen the staged path to autonomous conversation: **crawl** (draft on demand — shipped) → **walk** (auto-draft + human approval) → **run** (auto-send with escalations). The approval queue is next, and its hard requirement — approvals cannot be missed — is unsatisfiable while conversations are buried per-event. The inbox is the prerequisite surface, and it's independently useful today for 0106's existing threads.
