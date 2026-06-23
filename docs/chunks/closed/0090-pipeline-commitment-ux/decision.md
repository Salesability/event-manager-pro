# Pipeline panel — commitment-first redesign — Decision (Phase 1)

**Date:** 2026-06-22 · Resolves the [intent.md](intent.md) open questions / [plan.md](plan.md)
Phase-1 decision gate. All four land on the documented leans — the panel is a UI reshape over the
0087 building blocks, low-risk and reversible, so the lean defaults stand.

## D1 — Save model: **explicit small Save** (not auto-save-on-blur)

The next-action hero carries an inline commitment field + due + a compact **Save**. Explicit save is
predictable (no accidental writes when the rep tabs away mid-thought), matches the rest of the app's
form discipline, and keeps the server contract simple (one submit, one toast, one `router.refresh`).
Auto-save-on-blur was the alternative — rejected as surprising and harder to reason about against the
omit-when-absent patch semantics in `setDealerPipeline`.

## D2 — "Done" kind: **default `Call`, one-tap, with an inline kind picker + optional note**

Marking the current commitment **Done** defaults the activity kind to `Call` (the dominant rep
touch) so the common path is one tap. A small inline `<select>` is right there for the occasional
`email`/`meeting`/`note`/`other`, and an optional note field captures detail when it matters. The
rep is never *forced* to pick a kind — the default is always valid. This keeps "Done" friction-free
while preserving the structured-kind data the 0088 dashboard wants.

## D3 — Escape hatch: **keep, small + collapsed**

A collapsed **"+ Log a past touch"** disclosure stays for the occasional rich/after-the-fact entry:
kind + when (backdate `date`) + note → `logDealerActivity` **without** sending the next-action fields
(so an out-of-band note never clobbers the live commitment). Collapsed by default so it doesn't
compete with the hero. Dropping it entirely was the alternative — rejected because backdating a
missed touch and recording a substantive note are real (if infrequent) needs, and the cost of a
collapsed disclosure is near zero.

## D4 — Byproduct logging: **keep `dealer_activities` writes**

Confirmed: every **Done** records a `dealer_activities` row (kind + actor + `occurred_at`) and stamps
`last_contacted_at`. The activity trail is what the **0088 dashboard** counts; "next-action-only"
(drop panel activity writes) would strand that dashboard. The change is *how* a row is born (a
byproduct of completing a commitment, not a standalone 5-field form), not *whether* one is born.

## D5 — Mechanics: **reuse existing actions, no new gated action, no migration**

- **Done** → `logDealerActivity({ kind, note, nextAction, nextActionAt })` in **one submit**: it
  already inserts the touch, stamps `last_contacted_at`, and — because the Done form always sends
  `nextAction`/`nextActionAt` — **replaces** the completed promise with the next one (or clears it to
  null when the rep leaves "next commitment" blank). No server change needed.
- **Set / edit a commitment** (without completing one) → `setDealerPipeline({ nextAction,
  nextActionAt })`, which does **not** write an activity row (setting a promise isn't a touch). It
  omits `stage`/`priority`/`ownerId`, so those are preserved.
- **Stage / Priority / Owner** edit → `setDealerPipeline` with just those fields (omits next-action,
  so the commitment is preserved).
- **Escape-hatch note** → `logDealerActivity` **without** next-action fields (commitment preserved).

No new exported action ⇒ **no gate-matrix row**. No new column ⇒ **no migration**. Locked-once-active
behavior is inherited from `setDealerPipeline`/`logDealerActivity` and the panel's `locked` branch.

## Resulting panel shape (drives Phase 3)

1. **Next-action hero** (top, prominent):
   - *Has commitment* → loud display (overdue/due-today styling matching the `/dealerships` queue) +
     **Done** (primary) + a small **Edit** link. Done opens an inline form (kind=Call default,
     optional note, next-commitment + due). Edit opens an inline commitment+due field (no touch).
   - *No commitment* → "what do you owe them?" prompt + one field + due + **Set commitment**.
2. **Compact metadata row** (de-emphasized): Stage / Priority / Owner as badges + a collapsible
   **Edit details** (the three selects + Save). Last-contacted shown read-only.
3. **Recent activity** list — unchanged.
4. **"+ Log a past touch"** escape hatch — collapsed (D3).
5. **Mark won** — unchanged.

The duplicate next-action field and the standalone 5-field log form are removed; there is **one**
next-action input visible at a time (the hero's view/Done/Edit/Set states are mutually exclusive).
