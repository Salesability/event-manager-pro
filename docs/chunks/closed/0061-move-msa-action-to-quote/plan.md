# Move MSA send action to the quote page — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-05-29

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Server — relax `sendMsaEnvelope` to draft\|sent | Done | `96c75eb` |
| 2: Quote page — load + pass MSA state to composer | Done | `c33d3ca` |
| 3: Composer — state-aware bundle button (primary/secondary) | Done | `7b7eadd` |
| 4: Dealer page — remove action, keep read-only status | Done | `8dd5493` |
| 5: Tests + smoke + wiki | Done (smoke via chunk-end eval) | `cea2e52` + `f8386c2` |

Move the bundled MSA + Quote e-signature action from the admin-only dealer page onto the
admin+coach quote composer, and make the toolbar reflect MSA state (none → bundle is the
primary CTA; active → plain Send + indicator; in-flight → disabled). "Done" = a coach can
trigger the signed bundle from the quote they're looking at (draft or sent), the dealer page
keeps its read-only MSA panel, and the wiki + tests track the new home.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape
(length, error handling, naming, query style). For modifications to an existing file, the
anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Relax quote-status guard in `sendMsaEnvelope` | `src/features/msa/actions.ts:257` (draft-only guard) **and** `:387` (`quotes.msa_id` link UPDATE guarded `status='draft'`) | Both gate on `draft`; **both** must accept `sent` or a sent quote sends but never links → auto-accept-on-sign breaks |
| Relax auto-accept-on-sign guards (found during Phase 1) | `src/features/msa/lifecycle.ts:56` (`acceptBundledQuote` SELECT) **and** `src/features/quotes/lifecycle.ts:173` (`markQuoteAcceptedViaEnvelope` UPDATE) | Both hardcoded `draft`; a sent bundled quote would never accept when the webhook fires. Same draft\|sent widening. |
| `MsaSendForSignatureButton` (new client trigger+dialog for the composer) | `src/features/msa/msa-panel.tsx:17` (`MsaCreateTrigger`) + `src/features/msa/msa-create-dialog.tsx:44` (`MsaCreateDialog`) | Same two-step `createMsaDraft → sendMsaEnvelope` flow + dialog shape; adapt to take the *current* quote, not `firstDraftQuoteForDealer` |
| Composer toolbar branch (primary/secondary + indicator) | `src/features/quotes/quote-composer.tsx:402` (`composerActions`) + `:484` (`msaEnvelopeInFlight` banner) | New buttons ride the same `<PageHeader actions>` slot; banner block is the place for the "MSA active" / "awaiting signature" lines |
| New composer props (MSA state, quote createdAt) | `src/features/quotes/quote-composer.tsx:96` (`Props` type) + `:106` (`msaEnvelopeInFlight` prop doc) | Match the existing prop-doc style; extend the same discriminated MSA-state surface |
| Quote page loader passes MSA state down | `src/app/(app)/quotes/[id]/page.tsx:68` (parallel load) + `:79` (`msaEnvelopeInFlight`) + `:162` (`<QuoteComposer>` props) | MSA already loaded here; thread status/expiry + createdAt into the composer |
| Dealer page: drop button, keep status, swap empty-state | `src/app/(app)/dealerships/[id]/page.tsx:152` (no-MSA empty state w/ `MsaCreateTrigger`) | Surgical: remove the trigger + its data deps, keep the `dl` status block intact |
| Sent-quote bundle test | `src/features/msa/actions.test.ts` (existing `sendMsaEnvelope` cases) | Same harness; add a `status='sent'` case asserting success + `msa_id` link |
| `MsaSendForSignatureButton` (new client component) | `src/features/msa/msa-panel.tsx` (trigger) + `msa-create-dialog.tsx` (dialog) | Same button+dialog shape; bundles the open quote instead of `firstDraftQuoteForDealer` |
| `deriveQuoteMsaState` helper + test (added Phase 3) | `src/features/msa/queries.ts` (`Msa` read-model) | Pure mapping from the MSA read-model to the toolbar's 4-flag send state; unit-tested in lieu of absent render-test infra |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — the bundled first-deal envelope (Quote+MSA, one signature); update the "Create MSA + send" location + draft|sent eligibility on ship.
- `docs/wiki/auth.md` — `quote:edit` / `msa:edit` are both admin||coach; the quote page gate (`quote:edit`) is the right home for an `msa:edit` action.
- `docs/wiki/layout.md` — `<PageHeader actions>` toolbar + canonical button vocabulary; secondary = `outline`, primary = `color="green"`.

**Overall Progress:** 100% (5/5 phases complete — chunk-end `/eval` pending)

**Note:**
- Each phase includes both implementation and tests.
- The Phase 1 server relaxation is the load-bearing correctness change — verify the `msa_id` link path (not just the status guard) with a sent-quote test before the UI assumes it works.

### Phase Checklist

#### Phase 1: Server — relax `sendMsaEnvelope` to accept draft **or** sent
- [x] `src/features/msa/actions.ts:257` — guard now rejects only when status is **not** `draft` and **not** `sent` (terminal `accepted`/`declined` still rejected).
- [x] `src/features/msa/actions.ts:387` — the `quotes.msa_id` link UPDATE widened to `inArray(quotes.status, ['draft','sent'])` so a sent quote actually links to its MSA.
- [x] Comments at `:288` and `:378` updated from "draft" to "draft|sent".
- [x] **Sanity-check found TWO more hardcoded `draft` guards** (the plan's "no change expected" note was wrong — without these, a sent quote would send + link but never auto-accept on signing):
  - [x] `src/features/msa/lifecycle.ts:56` — `acceptBundledQuote`'s SELECT that picks the quote to accept was `eq(quotes.status,'draft')`; widened to `inArray(['draft','sent'])` (+ `inArray` import + comment).
  - [x] `src/features/quotes/lifecycle.ts:173` — `markQuoteAcceptedViaEnvelope`'s guarded UPDATE was `eq(quotes.status,'draft')`; widened to `inArray(['draft','sent'])` (+ `inArray` import). Rewrote the function's doc-comment (was "transition is draft→accepted, not sent→accepted" / "never emailed through sendQuote") to state draft|sent and that signing supersedes the email validity window (no expiry guard, by design).
- [x] Updated `src/features/quotes/lifecycle.test.ts` — the case asserting `sent` *errors* now asserts `sent → accepted` succeeds; added a separate `declined`-source error case.
- [x] Updated `src/features/msa/actions.test.ts` — the "rejects when not in draft" case (used `sent`) now uses a terminal `accepted` quote + asserts the new "must be in draft or sent" message. (Positive sent-path test deferred to Phase 5.)
- [x] Fast gate: `tsc` clean, `pnpm test` 917 passed / 2 skipped.

#### Phase 2: Quote page — load + pass MSA state to the composer
- [x] `src/app/(app)/quotes/[id]/page.tsx` — derived an `msaState` object from the already-loaded `msa`: `active` (`status==='active'`), `expiresAt` (active only), and **`bundleEligible`** (`msa==null || expired || terminated` — precisely the states where `createMsaDraft` won't collide with a pending/active row). The existing `msaEnvelopeInFlight` is unchanged.
- [x] Passed `msaState` + `quoteCreatedAt={quote.createdAt}` to `<QuoteComposer>`. `recipient` + `initial.{quoteId,dealerId,dealerName}` already flow in.
- [x] No new query — `loadActiveOrPendingMsa` already selects `status`/`expiresAt`/`providerDocumentId` (confirmed in `queries.ts`).
- [x] **Reshuffle from plan:** added the composer `Props` declarations (`msaState?`, `quoteCreatedAt?`) **here in Phase 2** (not Phase 3) so the page can pass them and `tsc` stays green per-phase. Consumption (toolbar branching) stays Phase 3. Chose a single `msaState` object over the plan's separate `hasActiveMsa`/`msaExpiresAt` props.
- [x] Fast gate: `tsc` clean, `pnpm test` 917 passed / 2 skipped.

#### Phase 3: Composer — state-aware bundle button (primary + secondary)
- [x] `Props` extended in Phase 2 (`msaState?`, `quoteCreatedAt?`); destructured + consumed here.
- [x] Built `MsaSendForSignatureButton` (`src/features/msa/msa-send-button.tsx`) — green primary button that reuses `MsaCreateDialog`, passing the **current** quote `{ id, createdAt }` as `firstDraftQuote` (no dialog change needed; dialog's null/"create one first" branch never renders since the quote always exists here).
- [x] `composerActions`: when `showBundle` (`canSend && bundleEligible`) → "Send Quote" demotes to `outline` (typed conditional spread to satisfy Catalyst's color-XOR-outline union) and `MsaSendForSignatureButton` renders as the rightmost primary CTA. Active MSA → "Send Quote" stays green. Bundle gated to `draft`/`sent` via `canSend`.
- [x] Indicator block: added an amber "No active MSA — acceptance requires the signed MSA + Quote bundle" hint (when `showBundle`) and a zinc "MSA active — expires <ISO date>" line (when `canSend && hasActiveMsa`). Used `toISOString().slice(0,10)` (deterministic — no SSR/client locale-tz hydration drift).
- [x] **Testing-infra note:** this repo has **no** React render-test infra (no `@testing-library/react`/jsdom; zero `.test.tsx`). Rather than add it (scope creep), the state logic was extracted to a pure tested helper `deriveQuoteMsaState` (`src/features/msa/send-state.ts`), and the page now routes both `msaEnvelopeInFlight` + `msaState` through it (de-dupes the inline derivation). Button-model **rendering** is covered by the Phase 5 browser smoke.
- [x] `src/features/msa/send-state.test.ts` — 7 cases: none / active(+expiresAt) / expired / terminated / pending-in-flight / pending-unsent / active-null-expiry. (Covers the "correct affordance per MSA state" + "terminal quotes get no bundle" intent at the logic layer; terminal-quote hiding is `canSend`-gated in the composer and smoke-verified.)
- [x] Fast gate: `tsc` clean, `pnpm test` 924 passed / 2 skipped (52 files).

#### Phase 4: Dealer page — remove action, keep read-only status
- [x] `src/app/(app)/dealerships/[id]/page.tsx` — removed `<MsaCreateTrigger>` from the no-MSA empty state; replaced with a pointer ("…sent for signature from that quote — open or create one in **Quotes** below"). The `dl` status block (created/signed/expires/download) is untouched.
- [x] Dropped the now-orphaned data deps: `firstDraftQuoteForDealer` + `resolveQuoteRecipient` imports, their `Promise.all` entries, and the `recipient` computation. `Promise.all` is now `[quotes, msa]`.
- [x] **Fate decided — deleted, not kept:** `MsaCreateTrigger` had only the dealer page as a consumer (the new `MsaSendForSignatureButton` calls `MsaCreateDialog` directly), so `src/features/msa/msa-panel.tsx` was deleted (`git rm`). `MsaCreateDialog` stays (the new button uses it).
- [x] Also removed the now-dead `firstDraftQuoteForDealer` query from `queries.ts` (+ its `quotes` import) and its two `queries.test.ts` cases — no remaining consumer after the dealer-page removal.
- [x] Updated the `msa-send-button.tsx` doc-comment that referenced the deleted `MsaCreateTrigger`.
- [x] Fast gate: `tsc` clean, `pnpm test` 922 passed / 2 skipped (−2 from the removed dead-query tests).

#### Phase 5: Tests + smoke + wiki
- [x] `src/features/msa/actions.test.ts` — added a `sendMsaEnvelope` case with `quote.status='sent'`: asserts success **and** that the `quotes.msa_id` link UPDATE still fires (guards the Phase 1 `:387` fix). (923 passed.)
- [x] `src/lib/auth/capabilities.test.ts` — green, no change needed (`msa:edit` admin||coach already covered); confirmed by the full run.
- [x] Wiki: `docs/wiki/commercial-spine.md` — added a "Where it's triggered (0061)" bullet (quote-page launch + state-aware toolbar + draft|sent eligibility) and fixed the cascading-flip wording to `draft|sent → accepted`. `docs/wiki/log.md` entry prepended.
- [x] Smoke (`/quotes/12`, draft, no-MSA dealer): **Send for signature** (green primary) + **Send Quote** (outline) + amber "No active MSA…" hint. Dialog "Send MSA + first Quote for signature" opens; **not** submitted. Screenshots `/tmp/emp-q12-toolbar.png`.
- [x] Smoke (`/quotes/11`, sent, active-MSA dealer): **Re-send Quote** present, **Send for signature** absent, "MSA active — expires 2027-05-22" indicator. `/tmp/emp-q11-activemsa.png`.
- [x] Smoke (`/dealerships/1`, active MSA #7): MSA section read-only (status/created/signed/expires/template/download), **no** "Create MSA + send" button. `/tmp/emp-dealer1.png`.
- [x] Smoke (post-fix `099d6a4`): dirtying `/quotes/12` (audience 1500→1750) disables **both** send buttons + shows the unsaved-changes banner. `/tmp/emp-q12-dirty.png`.

#### Chunk-end `/eval` — [eval-2026-05-29-1418.md](eval-2026-05-29-1418.md)
**Verdict: PASS with warnings.** Static green (tsc + 923 tests; chunk lint clean — the 145 `pnpm lint` errors are all pre-existing baseline in untouched files). **Browser smoke 5/5 GREEN** (dev server started for the run, then stopped; read-only — no BoldSign submit). Codex: 1 Medium **fixed in-cycle + browser-verified** (`099d6a4` — the new bundle button lacked the `isDirty` guard the Send-Quote button has, so it could bake stale pricing into the signed envelope), 1 High **parked** as a pre-existing race (see below).

**Parked — 0061 follow-up (a): claim-the-quote-before-external-side-effects in `sendMsaEnvelope`.** The `quotes.msaId` link UPDATE runs *after* the BoldSign post and ignores its result, so a status change between preload and link can leave a signed MSA active while the bundled quote never auto-accepts. Pre-existing (predates 0061; same family as the already-parked **0041 follow-up (a)** concurrent-send race). Fix shape: guarded `UPDATE … RETURNING` (`draft|sent` + `msa_id IS NULL`) *before* external side effects; abort if no row claimed. Un-park trigger: hardening the MSA send path, or a report of a signed-but-not-accepted bundled quote.
