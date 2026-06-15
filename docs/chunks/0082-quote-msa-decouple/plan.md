# Decouple the quote from the MSA / BoldSign envelope — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-15

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate (msaId fate · MSA send home · accept gate) | **Done** (`decision.md`) | - |
| 2: MSA-only envelope (strip quote from `sendMsaEnvelope`) | Done | `a719f66` |
| 3: Quote standalone accept + MSA-active gate | Done | `ac1aec6` |
| 4: Remove dead coupling + DROP `quotes.msaId` migration | Pending | - |
| 5: Tests + smoke verification + wiki | Pending | - |

Unwind the first-deal bundle so the MSA signs on its own envelope and every quote
runs the plain email-send + click-accept flow (quotes never touch BoldSign), while
keeping "MSA signed before first quote accept" as an explicit gate. "Done" = an MSA
envelope contains only MSA pages, signing it changes no quote's status, and the first
quote on a dealer accepts through the normal quote path once its MSA is active.

## Code Anchors

For each change below, the builder reads the anchor first and matches its shape
(error handling, naming, query style). Most of this chunk is *removal/relaxation* of
existing coupling, so the anchors are the current coupled call sites — the "what we're
moving away from" reference — plus the standalone-quote-accept path that becomes the
single accept route.

| Change | Anchor (`path:line`) | Why this anchor |
|--------|---------------------|-----------------|
| Strip quote load/render/merge from MSA send | `src/features/msa/actions.ts:158-377` (`sendMsaEnvelope`) | The coupling engine — loads quote (`:207-228`), renders quote PDF (`:256-277`), merges (`:283-289`), links `msaId` (`:352-361`). The change *is* this function. |
| New/relocated "Send MSA for signature" entry point | `src/features/msa/msa-create-dialog.tsx` + `src/features/msa/send-state.ts` (`deriveQuoteMsaState`) | Current quote-coupled trigger + the button-label state machine that simplifies once the quote is out. |
| Standalone first-quote accept (the surviving accept path) | `src/features/quotes/lifecycle.ts:76-143` (`markQuoteAccepted`) | The expiry-guarded `sent → accepted` helper that becomes the *only* accept route; the MSA-active gate hangs off here (or its caller). |
| First-quote-accept gate (block until MSA active) | `src/features/quotes/lifecycle.ts:76-143` + dealer MSA lookup as in `src/features/msa/actions.ts:207-228` | Pre-load guard pattern (JS message + DB predicate) already used for the expiry gate — mirror its shape for the MSA-active gate. |
| Remove quote re-send MSA-pending guard | `src/features/quotes/actions.ts:807-834` | The in-flight block that exists only because the quote rode the MSA envelope; goes away with the bundle. |
| Remove bundled-quote auto-accept | `src/features/msa/lifecycle.ts:52-97` (`acceptBundledQuote`) + `markMsaSigned` caller | Webhook side-effect that flips the bundled quote — deleted; MSA sign now flips only the MSA (+ prospect promotion at `:76-96`, which stays). |
| Delete now-dead merge helper | `src/lib/pdf/merge.ts:35-67` (`combineQuoteAndMsa`) | Only consumer is `sendMsaEnvelope`; confirm no other caller, then delete. |
| Delete now-dead envelope-accept helper | `src/features/quotes/lifecycle.ts:163-186` (`markQuoteAcceptedViaEnvelope`) | The no-expiry accept used only by the webhook bundle; dead once auto-accept is gone. |
| Webhook stops touching quotes | `src/app/api/boldsign/webhook/route.ts:72-126` (`handleSigned`) | After decoupling it flips the MSA only — confirm it no longer reaches into quote status. |
| `quotes.msaId` column fate | `src/lib/db/schema/quotes.ts:56-59` + index `:106` | Keep-or-drop decision (Phase 1); if kept, it's retained-but-unwritten (expand→contract, no migration). |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — the bundled-envelope description (lines ~72-83, "The bundled first-deal envelope") is the canonical text that must be rewritten to the decoupled model in Phase 5.
- `CLAUDE.md` → Conventions — mutations go through Server Actions; any schema/migration touch invokes the `db-conventions` skill.
- [[project_msa_structure]] — 12-month MSA per client; accepted quote IS the contract; MSA signed before first quote-accept (the rule the gate preserves).

**Overall Progress:** 60% (3/5 phases complete)

**Note:**
- This chunk is mostly *removal/relaxation* of coupling, not new feature code — keep test cases focused on the new boundaries (MSA-only envelope, no quote side-effect on sign, gated first accept).
- Integration tests come last, after the behavioral phases pass (verifies real DB behavior + the webhook no longer mutates quotes).

### Phase Checklist

#### Phase 1: Decision gate (`decision.md`)
- [x] **`quotes.msaId` fate → DROP** (owner call, 2026-06-15). Contract migration: drop the FK column + `quotes_msa_id_idx`. **Sequenced after** the code stops writing it (Phase 2) and reading it (Phase 4) — drop migration lands in Phase 4 (or its own Phase 4b). Historical link to which MSA a bundled quote signed under is not preserved on the row (the `quote.accepted` audit `payload.via='msa-envelope'` already records that it came via an envelope). Invoke `db-conventions` for the migration.
- [x] **"Send MSA for signature" home → the existing per-dealer MSA panel on `/dealerships/[id]`** (`page.tsx:143-195`). That panel already renders MSA status / signed / expires / signed-PDF; it just lacks the *send* action (its empty-state currently says "sent for signature from that quote"). Move `msa-send-button` there; reword the empty state. _(Standalone cross-dealer MSA list view = optional, owner TBD — see Open call below.)_
- [x] **Accept-gate scope → require an ACTIVE MSA to accept ANY quote** (owner call, 2026-06-15; stricter than first-only, covers MSA expiry). Lives in `acceptQuote`/`markQuoteAccepted` (server reject) + disabled "Mark accepted" + helper copy on `/quotes/[id]`. Reuse `loadActiveOrPendingMsa` (`features/msa/queries.ts:53`).
- [x] **No cross-dealer MSA list view** (owner call) — per-dealer panel only.
- [ ] (build-time) Confirm nothing else reads `combineQuoteAndMsa` / `markQuoteAcceptedViaEnvelope` / `quotes.msaId` after decoupling (grep) — folded into Phases 2/4.
- [x] Wrote [`decision.md`](decision.md) — D1 drop msaId · D2 send-on-dealer-panel · D3 active-MSA-any-accept · D4 no list.

#### Phase 2: MSA-only envelope
- [x] Stripped quote load + quote-PDF render + `combineQuoteAndMsa` from `sendMsaEnvelope`; now renders the MSA alone and posts an MSA-only envelope (`msaPdf.signatureAnchor`, no initials anchor, metadata `{ msaId }`). Dropped now-dead imports + the `isoDateOffset` helper.
- [x] Removed the `quotes.msaId` link UPDATE + the `quoteId` from the `msa.sent` audit payload.
- [x] Moved the MSA send action onto the per-dealer MSA panel (`dealerships/[id]/page.tsx`): resolves the recipient, gates on `canSendMsa` (no usable MSA + not archived), renders `MsaSendForSignatureButton`; reworded the empty-state copy. Removed the bundle button + `showBundle`/bundle-note from the quote composer; `MsaCreateDialog`/`MsaSendForSignatureButton` lost their quote props.
- [x] Test: `sendMsaEnvelope` unit suite rewritten for MSA-only (single file, no `initialsAnchors`, one UPDATE, no quote read/write); 101/101 touched-area unit tests pass.

> **Access note:** the dealer page is `admin:access`-gated, so moving the MSA send action here makes it **admin-only** (0061 had put it on the coach-accessible quote page). MSA = the once-per-client master contract, so admin-only sending is acceptable — captured in `decision.md` D2 / to surface in the Phase 5 wiki update.

#### Phase 3: Quote standalone accept + MSA-active gate
- [x] **Discovered no Accept/Decline UI existed** (the MSA webhook was the only accept path). Paused; owner chose **Accept + Decline** (D5). Built `QuoteStatusActions` (staff "Mark accepted" / "Decline", each behind a confirm dialog) wired to the existing `acceptQuote`/`declineQuote`; rendered in a "Customer decision" card on `/quotes/[id]` for `sent` quotes only.
- [x] Added the MSA-active gate to `acceptQuote` (server reject): loads `{ dealerId, status }`; a `sent` quote with no `active` MSA returns "Sign the master agreement first…". Gates only the real transition (non-`sent` skips → idempotent re-accept preserved). Reuses the loaded `dealerId` for the prospect→active promotion (dropped the duplicate select). Accept button mirrors the gate (disabled + helper copy when no active MSA / expired).
- [x] Simplified `deriveQuoteMsaState` — dropped `bundleEligible` (the bundle is gone); kept `active`/`expiresAt`/`envelopeInFlight`. Composer keeps only the informational "MSA active — expires" indicator + the (Phase-4-bound) re-send gate.
- [x] Tests: rewrote the `acceptQuote` suite for the gate (new no-active-MSA + quote-not-found cases; happy paths carry an active-MSA row); updated `send-state.test.ts`. `tsc` clean; 99/99 touched-area unit + 295 gate-matrix pass.

#### Phase 4: Remove dead coupling
- [ ] Delete `acceptBundledQuote` + its call from `markMsaSigned`; MSA sign flips only the MSA (+ keep prospect→active promotion).
- [ ] Remove the quote re-send MSA-pending guard (`actions.ts:807-834`).
- [ ] Delete `combineQuoteAndMsa` (`src/lib/pdf/merge.ts`) and `markQuoteAcceptedViaEnvelope` once unreferenced.
- [ ] Confirm the BoldSign webhook no longer reaches into quote status.
- [ ] **DROP `quotes.msaId` migration** — drop column + `quotes_msa_id_idx` (only after the writers/readers above are gone). Invoke `db-conventions`; apply to sandbox.
- [ ] Test: a `Signed` webhook event flips the MSA only; no `quote.accepted` audit emitted.

#### Phase 5: Tests + smoke verification + wiki
- [ ] Integration test: full decoupled path — send MSA (MSA-only) → sign (webhook) → MSA active, quote untouched → send quote → accept → `quote.accepted`.
- [ ] Integration test: first-quote accept rejected when dealer MSA not active (real DB).
- [ ] Smoke (web-test): `goto /quotes/[id]` for a no-active-MSA dealer; quote page shows its own **Send Quote** control (not a bundled "Send for signature" standing in for it).
- [ ] Smoke (web-test): `goto /dealerships/[id]` (or the Phase 1 MSA-send home); the "Send for signature" / MSA action renders there.
- [ ] Update `docs/wiki/commercial-spine.md` — replace the bundled-envelope section with the decoupled model; add a `log.md` entry.
