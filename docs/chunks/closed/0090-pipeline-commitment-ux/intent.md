# Pipeline panel — commitment-first redesign — Intent

**Created:** 2026-06-22 · Surfaced from a live UI review this session: after 0087 shipped to prod,
the owner found the dealer Pipeline panel **too burdensome for reps** and wants the panel
organized around **next-action commitments** (the trust-builder), not activity logging. This is a
follow-up to **0087** (which stays closed); it reshapes the rep panel only.

## Problem

The 0087 Pipeline panel (`/dealerships/[id]`) has **two competing forms**:

1. **Pipeline** — Stage / Priority / Owner + **Next action + Due** + "Save pipeline"
2. **Log activity** — Type / When / Note + **Set next action (optional) + Due** + "Log activity"

So the single most important field — the **next-action commitment** ("call Tuesday / send
pricing") — is **duplicated** across both forms, each with its own save button. And the 5-field
log-activity form (Type · When · Note · Set-next-action · Due) is friction a busy rep won't
sustain — which means the activity data it was added to feed (the **0088 dashboard** counts) ends
up empty anyway. The panel buries the hero (the commitment) inside a settings form and makes the
low-value bookkeeping (logging) the prominent action.

This contradicts 0087's own reframe: the chunk was deliberately re-scoped from a stage funnel to a
**commitment tracker** ("don't drop the ball" — keep the small promises that win trust). The
activity log was a later, management-driven add. Lived experience says the commitment is the value;
the log is tax.

## Desired outcome

A **commitment-first** panel where the next action is the hero and logging is a *byproduct*:

- **Next action is the top, prominent control** — one inline commitment field + due, one save (or
  auto-save). It's the first thing a rep sees and edits.
- **"Done" replaces the standalone log form.** Completing the current next-action records a touch
  (kind defaults to `Call`, optional note), stamps `last_contacted_at`, and immediately prompts for
  the next promise. Logging happens *because you finished a commitment*, not as a separate chore.
- **Stage / Priority / Owner shrink** to a compact secondary metadata row (they change rarely).
- A small **"+ note" / backdate escape hatch** stays for the occasional rich or after-the-fact
  entry.
- The rep loop becomes: *see what I owe → do it → "Done" (Call) → type the next promise.*

**Activity capture is preserved** — `dealer_activities` rows are still written (so the 0088
dashboard's activity counts survive); only *how* a row is born changes (via "Done", not a 5-field
form). No data migration.

Observable end state: opening a dealer, the rep sees the current commitment front-and-center, marks
it done in one tap (picking up an activity row for free), and sets the next promise — with stage/
owner metadata available but out of the way.

## Non-goals (v1 scope guard)

- **No data-model / migration change.** `dealer_activities` + the `dealers` pipeline columns are
  unchanged; this is UI + a small server affordance (reusing `logDealerActivity`, which already
  optionally sets the next action in the same call).
- **No change to the `/dealerships` commitment queue** (0087 Phase 5) — list view is fine; this is
  the per-dealer panel only.
- **Not removing activity tracking** — the lean path still records touches for 0088. (If the owner
  decides next-action-only with zero activity capture, that's a Phase-1 decision, but the lean
  default is byproduct logging.)
- **No automation** (auto-stage from quote/MSA events, reminders/notifications) — later.
- **No coach-visibility change** — the panel stays admin-only until the `/dealerships` gate opens.

## Success criteria

- The panel leads with the next-action commitment; the duplicate "next action" field and the
  standalone 5-field log form are gone.
- "Done" records a `dealer_activities` row (kind + actor + timestamp) + stamps `last_contacted_at`
  + advances to the next promise, in one flow.
- Stage/Priority/Owner remain editable but de-emphasized.
- 0088's activity counts still have data (byproduct logging confirmed).
- Static gate green; the reshaped flow has unit/integration coverage; web-test smoke drives the new
  panel.

## Open questions (Phase-1 decision gate)

- **Save model** — auto-save the next-action on blur vs an explicit Save. Lean: explicit small Save
  (predictable), but open.
- **Does "Done" force a kind pick** (Call/Email/…) or default silently to `Call` with an optional
  change? Lean: default `Call`, one-tap, with an inline kind picker.
- **Keep the "+ note" / backdate escape hatch** or drop it for pure simplicity? Lean: keep, small.
- **Confirm byproduct logging** (keep `dealer_activities` writes for 0088) vs next-action-only
  (drop panel activity writes). Lean: keep — don't strand the dashboard.

## Why now

0087 is live on prod with 188 prospects to work; the rep panel is the daily surface and its current
shape discourages the exact behavior the chunk exists to drive (keeping commitments). Fixing the
panel's center of gravity now — before reps form the habit of ignoring it — protects the whole
feature's value.
