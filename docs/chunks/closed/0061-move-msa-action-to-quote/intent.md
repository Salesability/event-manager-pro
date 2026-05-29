# Move MSA send action to the quote page — Intent

**Created:** 2026-05-29

## Problem

The "Create MSA + send for signature" action — the trigger that bundles the Master
Service Agreement with a Quote into one BoldSign e-signature envelope — lives on the
**dealer (Client) detail page** (`src/app/(app)/dealerships/[id]/page.tsx`). Two things
are wrong with that home:

1. **Coaches can't reach it.** The dealer detail page is gated `assertCan('admin:access')`,
   yet `msa:edit` is granted to **admin _or_ coach** (`src/lib/auth/capabilities.ts`, mirrors
   `quote:edit`). Coaches own the Client relationship in the coach-owned-business model and
   are the people who actually send quotes — but the only surface that triggers an MSA send
   sits on a page they cannot open. So coaches literally cannot send a first-deal envelope today.
2. **It's buried, and disconnected from its quote.** The bundled envelope is fundamentally
   tied to a *specific* quote (Quote first, Agreement last, one signature). On the dealer page
   the action has to *guess* the quote via `firstDraftQuoteForDealer(dealerId)`. The coach is
   usually looking at the quote they want to send — that's where the action belongs.

On top of that, nothing on the quote page tells the coach **whether an MSA is even needed**.
A brand-new Client must sign the bundle; a Client with an active MSA just needs a plain quote.
Today the coach has to go cross-reference the dealer page to know which.

## Desired outcome

The MSA send action moves to the **quote composer page** (`/quotes/[id]`, gated admin+coach),
and the toolbar becomes **state-aware** so it's obvious whether the signed bundle is required:

- **No active MSA** → "Send for signature" (the bundled MSA + Quote e-sign envelope) is the
  **primary** green CTA; the existing "Send Quote" (plain review email) is demoted to a
  secondary/outline button. Both remain available.
- **Active MSA on file** → only "Send Quote" shows (unchanged behavior), plus a small
  "MSA active — expires <date>" indicator so the coach knows no signing is needed.
- **MSA envelope in flight** (pending + posted to BoldSign) → a disabled "MSA envelope
  awaiting signature" state (the quote page already computes `msaEnvelopeInFlight`).

The bundled envelope can be sent for a quote that's in **draft _or_ sent** status, so the
natural flow — email a quote for review, then send the *same* quote for signature — works
without dead-ending.

The dealer detail page **keeps its read-only MSA status panel** (status badge, created/signed/
expires dates, download-signed-PDF link) — only the action button leaves, replaced by a short
pointer to send it from a quote.

## Non-goals

- No change to the BoldSign signing flow, the `/api/boldsign/webhook` handler, the PDF merge
  (`combineQuoteAndMsa`), or the field-anchor scaling.
- No change to the `master_service_agreements` schema or its lifecycle states
  (`pending → active → expired | terminated`).
- No MSA **renewal** UI (expired/terminated → new envelope) — still the v1 manual flow.
- No change to how `acceptQuote` works for active-MSA dealers.
- No change to the dealer page's read-only MSA status *display* beyond removing the button
  and swapping the empty-state copy.
- Not adding a standalone MSA-only envelope (MSA without a quote) — the bundle stays
  quote-anchored.

## Success criteria

- A coach (non-admin) viewing a quote for a Client with no MSA sees "Send for signature" as
  the primary action and can complete the create-draft → send-envelope flow.
- The same quote, for a Client with an active MSA, shows "Send Quote" as primary + an
  "MSA active (expires …)" indicator, and no bundle button.
- A quote that has already been **sent** (plain email) can still be sent as the signature
  bundle; the signed-webhook auto-accept flips that `sent` quote to `accepted` and links it
  to its MSA (`quotes.msa_id` set).
- The dealer detail page no longer shows the create button; its read-only MSA panel
  (incl. signed-PDF download) is intact.
- `docs/wiki/commercial-spine.md` reflects that the bundle is triggered from the quote page
  and that draft-or-sent quotes are eligible.

## Open questions

- Should the demoted "Send Quote" (review email) for a no-MSA Client carry any extra
  confirmation hinting "this won't collect a signature"? *(Working assumption: no — the
  primary CTA's prominence is enough; revisit if it confuses in smoke.)*
- The MSA dialog currently shows a recipient-resolution error inline. The quote page already
  resolves `recipient` for the Send dialog — confirm the same resolved value drives the
  bundle dialog (no second resolution path). *(Resolved in plan: reuse the page's `recipient`.)*

## Why now

Owner flagged the action as "a bit buried" on the dealer page and wants it where the work
happens (the quote). The capability asymmetry (coaches blocked from a coach-owned action) is
a latent correctness bug surfaced by this move, so it's the right moment to fix both together.
