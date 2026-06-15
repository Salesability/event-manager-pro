# Decouple the quote from the MSA / BoldSign envelope — Intent

**Created:** 2026-06-15

## Problem

The first deal with a new dealer merges the **quote PDF and the MSA into a single
BoldSign document** (`combineQuoteAndMsa`), and one signature flips *both* the MSA →
active *and* the bundled quote → accepted. That bundling — built up across
[`0037`](../closed/0037-commercial-spine-msa/plan.md) /
[`0041`](../closed/0041-msa-send-bundled-envelope/plan.md) /
[`0055`](../closed/0055-quote-msa-one-document/plan.md) /
[`0061`](../closed/0061-move-msa-action-to-quote/plan.md) — makes the quote and the
agreement structurally inseparable:

- The quote's primary CTA on a no-MSA dealer is **"Send for signature"**, which is really an MSA action that happens to carry the quote.
- A quote can't be re-sent while its MSA sits pending in BoldSign (`actions.ts` in-flight guard).
- The *first* quote is only ever accepted as a webhook side-effect of the MSA signature — it has no standalone accept path, unlike every later quote.

This conflates two separate commercial artifacts. The MSA is a 12-month master
agreement signed **once** per client; the quote is the per-event document that the
client accepts (the accepted quote *is* the contract — see [[project_msa_structure]]).
They should not ride in one envelope.

## Desired outcome

**The MSA is e-signed on its own BoldSign envelope (MSA pages only, no quote merged
in). Every quote — first or later — uses the existing send → accept flow. Quotes never
touch BoldSign.**

> **Accept mechanism (v1, unchanged by this chunk):** there is no customer self-serve
> "click to accept" — acceptance is **staff-recorded**. The coach emails the quote PDF
> (`sendQuote`), the client replies/phones, and the coach flips the status via the
> existing `acceptQuote` Server Action (`actions.ts:1261`, `quote:edit`-gated, which
> already promotes a prospect dealer → active). The schema's `acceptToken` is unused.
> Decoupling makes this the **single** accept route for all quotes; adding a public
> click-accept link is a *separate* future chunk, explicitly out of scope here.

The "MSA must be signed before the first quote is accepted" business rule is
**preserved as an explicit gate**, not as a consequence of one merged PDF:

- Sending the MSA for signature is its own action (not folded into a quote send).
- Signing the MSA flips the MSA → active and (if the dealer was a prospect) promotes the dealer — but does **not** auto-accept any quote.
- A quote is accepted only through its own send → accept path; the first quote-accept is blocked until the dealer has an active MSA.

A reader should be able to confirm success by sending an MSA, signing it, and seeing
no quote change status; then sending a quote and accepting it through the normal quote
flow.

## Non-goals

- **Not** removing the "MSA signed before first quote accept" rule — the gate stays; only the *artifact bundling* is unwound.
- **Not** adding e-signature to quotes — quotes are email-send + click-accept only, never a BoldSign document.
- **Not** changing the MSA's own BoldSign mechanics (SDK, webhook → MSA active, signed-PDF storage). The MSA still signs exactly as today, just without quote pages.
- **Not** a data migration of historical bundled quotes — already-accepted quotes stay accepted; this changes the *flow*, not past rows.
- **Not** touching the QuickBooks Estimate push, quote attachments, tax, or pricing.

## Success criteria

- The BoldSign envelope produced for an MSA contains **only** MSA pages (no quote lines/initials).
- Sending + signing an MSA leaves every quote's status unchanged (no webhook auto-accept of a quote).
- The first quote on a dealer can be accepted through the standard quote send → accept flow once the dealer's MSA is active — and is blocked (clear message) while it is not.
- `quotes.msaId` is no longer written by the send-for-signature path (column kept-or-dropped per the Phase 1 decision).
- `combineQuoteAndMsa`, `acceptBundledQuote`, `markQuoteAcceptedViaEnvelope`, and the quote re-send MSA-pending guard are removed (or proven still-needed and justified).
- Static checks green; browser smoke confirms the quote page no longer shows a bundled "Send for signature" CTA in place of its own send/accept controls.

## Open questions

- **Where does "Send MSA for signature" live now?** [`0061`](../closed/0061-move-msa-action-to-quote/plan.md) moved it onto the quote composer *because* it carried the quote. Decoupled, it belongs on an MSA/dealer-centric surface (the dealer/client page is the likely home — where it lived pre-0061). → Phase 1 / `decision.md`.
- **Where does the first-quote-accept gate live, and what's its UX?** Server-side reject in the accept action, plus a disabled Accept + helper text in the UI ("Sign the master agreement first")? → Phase 1.
- **Keep vs. drop `quotes.msaId`.** Expand→contract favours keep-the-column (no migration, preserves the historical link on already-bundled quotes); confirm nothing still reads it after decoupling. → Phase 1 / `decision.md`.
- **Gate scope — first-quote-only vs. require-active-MSA-for-any-accept.** The business rule names the *first* quote, but "no accept without an active MSA" is the cleaner, stricter form (also covers an expired MSA). Resolved → see `decision.md`. → Phase 1.
- ~~Does a standalone accept path already work for the *first* quote?~~ **Resolved during scaffolding:** `acceptQuote` (`actions.ts:1261`, staff) already works for any quote and becomes the single surviving accept route; the bundled-webhook accept (`markQuoteAcceptedViaEnvelope`) is the one that's deleted.

## Why now

The commercial spine is otherwise stable and live on prod (MSA e-sign via BoldSign is
production-verified; the QBO Estimate push, tax, and attachments all shipped). The
bundled-envelope design was a first-deal convenience that has since become a source of
coupling — the quote has no first-class accept path of its own, and the MSA can't be
sent without picking a quote. Separating them now, while the surrounding surface is
quiet, keeps each artifact's lifecycle independent and removes a class of "why is the
quote stuck behind the agreement" footguns.
