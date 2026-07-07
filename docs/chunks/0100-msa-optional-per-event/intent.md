# MSA optional per calendar event — Intent

**Created:** 2026-07-07

## Problem

Every calendar event today treats a missing/pending MSA as an unfinished step. Commercial protection is computed as `isExposed(quote, msa) = !(quote accepted && MSA active)` ([`src/features/schedule/commercial-status.ts:17`](../../../src/features/schedule/commercial-status.ts)), so an event with no active MSA is always painted as incomplete — the amber calendar dot ([`calendar-view.tsx:369`](../../../src/app/(app)/calendar/calendar-view.tsx)), the "⚠ Commercially exposed" banner + amber "No active MSA" row on the event detail ([`event-detail.tsx:94`](../../../src/app/(app)/calendar/event-detail.tsx)), the "Send MSA" CTA, and the post-booking "Send MSA for signature" prompt. There is **no way for a coach to say "this event doesn't need an MSA."** Worse, the hard accept gate in `acceptQuote` ([`quotes/actions.ts:1266`](../../../src/features/quotes/actions.ts)) then refuses to let the quote be accepted at all without an active MSA — so a coach who wants to skip the MSA is both nagged visually *and* blocked functionally.

## Desired outcome

A coach can **waive the MSA on a specific calendar event**. On a waived event:

- The MSA reads as a calm, neutral **"Not required"** pill — not amber, not pending, not an unfinished step.
- No "⚠ Commercially exposed" contribution from the MSA dimension, no MSA-triggered amber calendar dot, no "Send MSA" CTA.
- The quote for that event can be **accepted with no active MSA** (the accept gate is waived too — full opt-out, not cosmetic).

The waiver is **per-event** (`campaigns.msa_waived`) — other events for the same client are unaffected, and the per-client MSA legal model is untouched. It is **reversible**: un-waiving restores the normal "No active MSA" nag. The quote dimension of exposure is unchanged — only the MSA side responds to the waiver.

## Non-goals

- **Not** making MSAs per-event. The MSA stays a per-client 12-month master agreement on `master_service_agreements` — see [[project_msa_structure]]. The waiver is an event-level *opt-out*, not a new MSA scope.
- **Not** adding a per-client "never needs an MSA" flag — that's a broader decision; this chunk is deliberately per-event (owner call).
- **Not** touching BoldSign / e-sig wiring or the MSA PDF renderer.
- **Not** changing quote-status badges or the quote dimension of exposure.
- **No backfill** — `msa_waived` defaults `false`, so every existing event keeps today's behavior.

## Success criteria

- A waived booked event shows **"MSA — Not required"** (neutral) instead of amber "No active MSA"; no ⚠ banner from the MSA side; no amber calendar dot from MSA; no "Send MSA" CTA.
- The waive / un-waive control lives on the event detail and persists to `campaigns.msa_waived`.
- `acceptQuote` succeeds on a `sent → accepted` transition for a quote whose event is waived, even with **no** active MSA; a non-waived event's quote is still blocked as today.
- Un-waiving an event restores the amber "No active MSA" nag and re-arms the accept gate.
- A non-waived event is byte-for-byte unchanged (regression-clean).

## Open questions

- **Which capability gates the waive action?** Mirror the `admin:access` tightening applied to `sendMsaEnvelope` in 0082, or the coach-scoped `quote:edit`/`dealer:edit`? Resolve in Phase 1. (Leaning coach-scoped — the coach owns the booking decision.)
- **Should the post-booking prompt** ([`calendar-view.tsx:654`](../../../src/app/(app)/calendar/calendar-view.tsx)) gain an explicit **"MSA not needed for this event"** that sets the waiver (vs. only the event-detail toggle)? Leaning yes — it's the moment the coach is deciding, and "I'll do this later" already sits there as a soft skip.
- **Quote with a null `campaignId`** (the link is nullable — `acceptQuote` already "skips cleanly when the quote has no campaign link") has no event-level waiver to inherit → the accept gate falls back to the normal MSA requirement. Confirmed acceptable (a quote not tied to an event has no waiver to honor).

## Why now

Coaches are hitting the amber "commercially exposed" nag — and then the hard accept-quote block — on events where an MSA genuinely isn't wanted (an existing long-term client, a one-off). Making the MSA opt-out-able per event removes the false "incomplete step" signal and unblocks the quote. Builds directly on the 0093 calendar commercial-status surface and the 0082 accept gate.
