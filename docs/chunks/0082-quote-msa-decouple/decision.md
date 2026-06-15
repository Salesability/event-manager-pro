# 0082 — Decisions

**Date:** 2026-06-15
**Context:** Phase 1 decision gate for decoupling the quote from the MSA/BoldSign
envelope. Target end-state (owner, AskUserQuestion): **Option A — MSA solo; quote
send→accept; quotes never touch BoldSign**, with "MSA before first accept" kept as an
explicit gate. See [`intent.md`](intent.md).

---

## D1 — `quotes.msaId`: **DROP** (contract migration)

**Decision:** Drop the `quotes.msaId` FK column and its `quotes_msa_id_idx` index.

**Why:** After decoupling, nothing writes it (`sendMsaEnvelope` link UPDATE removed,
Phase 2) and nothing reads it (`acceptBundledQuote` webhook path removed, Phase 4). The
owner chose a clean drop over keep-retained-but-unused.

**Sequencing:** The drop migration lands in **Phase 4**, *after* the writers/readers are
gone — never before, or the running code would reference a missing column. Invoke
`db-conventions` for the migration; apply to **sandbox** (prod is a separate, later
deploy).

**Tradeoff accepted:** Historical bundled quotes lose the row-level pointer to the MSA
they signed under. Not a real loss — the `quote.accepted` audit already records
`payload.via = 'msa-envelope'`, and the signed combined PDF lives in GCS under the MSA.

---

## D2 — "Send MSA for signature" home: **the existing per-dealer MSA panel**

**Decision:** Move the MSA send action onto the **Master Service Agreement** section of
`/dealerships/[id]` (`src/app/(app)/dealerships/[id]/page.tsx:143-195`).

**Why:** That panel already exists and already renders MSA status / Created / Signed /
Expires / template version / **Download signed MSA**. It only lacks the *send* action —
its empty-state copy currently says the MSA "is sent for signature from that quote"
(a 0061 artifact). Decoupling moves the action back to a dealer-centric surface (its
pre-0061 home) where MSA state already lives.

**Work:** Relocate `msa-send-button` / `msa-create-dialog` here; reword the empty state
to describe the panel's own Send action.

---

## D3 — Accept gate scope: **require an ACTIVE MSA to accept ANY quote**

**Decision:** A quote can be accepted only while its dealer has an `active` MSA — not
just the first quote. (Owner chose the stricter form over the literal "first quote
only" rule.)

**Why:** Simpler invariant ("no accepting a quote without a live contract") and it
naturally re-blocks accepts when the 12-month MSA **expires** before renewal — the
first-only rule would leave a lapsed-MSA dealer able to keep accepting. Slightly
stricter than the literal business-rule wording, but commercially more correct.

**Where it lives:** the accept path — `markQuoteAccepted` (`lifecycle.ts:76`) /
`acceptQuote` (`actions.ts:1261`). Server-side reject (the backstop) with a clear
message ("Sign / renew the master agreement first"), plus a disabled **Mark accepted**
button + helper copy on `/quotes/[id]`. Reuse the dealer-MSA lookup shape from
`loadActiveOrPendingMsa` (`features/msa/queries.ts:53`).

---

## D5 — Add a staff Accept + Decline control (no accept UI existed)

**Decision:** Add a staff **"Mark accepted" + "Decline"** control to the quote page
(`QuoteStatusActions`), wired to the existing `acceptQuote`/`declineQuote` Server
Actions, each behind a confirm dialog. (Owner picked Accept + Decline over accept-only
or defer, AskUserQuestion 2026-06-15.)

**Why this surfaced mid-build (Phase 3):** the plan assumed the standard accept path
already had a UI. It did not — **there was no Accept/Decline button anywhere** in the
app. The *only* way any quote ever reached `accepted` was the MSA-envelope webhook (the
first/bundled quote), which Phase 4 removes. Without a staff control, decoupling would
leave every quote un-acceptable. The build loop paused and confirmed the shape with the
owner before building.

**Shape:**
- Renders only for a `sent` quote (draft can't be accepted; accepted/declined are terminal).
- **Accept** is disabled (with helper copy "Sign the master agreement first…") unless the dealer has an active MSA (D3), and disabled when the quote has expired (the server rejects it anyway).
- **Decline** uses the 0081 soft-red `destructive` treatment.
- Lives on the quote page in a "Customer decision" card above the composer.

**Out of scope (reaffirmed):** still no customer self-serve accept link — acceptance is
staff-recorded. A public token-validated accept route remains a separate future chunk.

## D4 — No cross-dealer MSA list view

**Decision:** MSA stays visible only on the per-dealer panel (D2). No global
`/admin/agreements` index in this chunk.

**Why:** The decouple doesn't need a portfolio view; the per-dealer panel is enough.
A cross-dealer "who's signed / who's expiring" list remains a clean additive follow-up
if it's ever wanted.

---

## Out of scope (reaffirmed)

- No customer self-serve "click to accept" — acceptance stays **staff-recorded**
  (`acceptQuote`); the schema's `acceptToken` stays unused. A public accept link is a
  separate future chunk.
- No change to the MSA's own BoldSign mechanics (SDK, webhook → MSA active, signed-PDF
  storage) beyond removing the quote pages from its envelope.
- No data migration of historical bundled quotes (already accepted).
