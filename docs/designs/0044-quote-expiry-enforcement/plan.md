# Quote expiry enforcement

**Started:** 2026-05-13
**Status:** Active — un-parked 2026-05-13 via user `/build 0044` (explicit focus-switch from 0043, which had not started any phase). Recommended Phase 3 path = Option B (derived `isExpired` field, no migration, Phase 4 skipped).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: `acceptQuote` expiry guard (minimum behavior fix) | Done | `3b60c93` |
| 2: Surface validity on PDF + email | Pending | - |
| 3: Resolve OQ #1 → implement `expired` lifecycle (enum / timestamp / none) | Pending | - |
| 4: (conditional on OQ #1 choice) Nightly sweep job | Pending | - |
| 5: Tests + smoke verification | Pending | - |

Honor the `quotes.quote_valid_days` column the schema has been carrying since 0037 Phase 4 (`drizzle/0017_tranquil_living_mummy.sql`). Today the default-30-days value lives on the row but **nothing reads it**: `acceptQuote` (`src/features/quotes/actions.ts:825`) doesn't refuse stale acceptances, the PDF renderer (`src/lib/pdf/render-quote.ts:129`) doesn't print a "Valid until" line, the send email (`src/lib/email/templates/quote.tsx`) doesn't either, and the `quote_status` enum has no `expired` value. Done = (a) staff `acceptQuote` refuses `sent → accepted` when `sentAt + quoteValidDays < now()` with a clear error message; (b) the dealer sees the deadline on both the PDF ("Valid until 2026-06-12") and the send email ("Please respond by 2026-06-12"); (c) the lifecycle decision (enum value vs timestamp vs nothing) is recorded in OQ #1 and the chosen path is implemented; (d) integration test + browser smoke + chunk-end `/eval` verify.

**Overall Progress:** 20% (1/5 phases complete)

## Open Questions

The Phase 3 implementation needs an answer before any UI/sweep work; Phases 1–2 don't depend on this and can land first.

1. **Lifecycle representation for expired Quotes** — three options. Recommendation **(B)** for v1; revisit when 0026 follow-up (c) staff accept/decline UI is built.
   - **(A) Add `'expired'` to `quote_status` pgEnum** + nightly sweep flips stale `sent` rows → `expired` + UI shows an `Expired` `<Badge>` everywhere status is rendered. Most semantically honest; mirrors how `master_service_agreements.status` already carries `expired` (per closed/0041). Costs: migration extending the pgEnum (`ALTER TYPE … ADD VALUE`, precedent in `drizzle/0019_msa_audit_actions.sql`), sweep job needs scheduler scaffolding (no cron infrastructure exists today — `pnpm dlx tsx scripts/...` is the closest pattern), audit-action enum extension (`quote.expired`), every UI/filter that switches on Quote status needs to handle the new value. Largest scope.
   - **(B) Hybrid: derive expiry, no enum extension.** Phase 1's guard refuses acceptance using `sentAt + quoteValidDays < now()`. PDF + email show the deadline (Phase 2). UI infers expired state at read time: `loadQuote` projects `isExpired = status === 'sent' && sentAt + quoteValidDays < now()`; the existing `STATUS_PILL_CLS` block adds a derived "Expired" pill for the inferred state. No migration, no sweep, no enum change. The pill is presentational; the underlying row stays `sent`. Costs: every status-rendering surface needs the derived-state read (composer header, /quotes index columns, send-receipt panel), but those are all `loadQuote` consumers so one projection field covers them. Phase 3 = "wire the derived field"; Phase 4 = skipped.
   - **(C) Add a nullable `expired_at` timestamp** (no enum change). Set by the sweep when `sentAt + quoteValidDays < now()`. UI reads `expiredAt != null` for "expired" display. Compromise between (A) and (B); costs a sweep job without the enum migration. Less consistent with the MSA pattern (which uses an enum value).

2. **Should declined Quotes also block acceptance?** Today `markQuoteAccepted` already refuses non-`sent` rows (the atomic guarded UPDATE filters on `status='sent'`). Phase 1 is layering the time-based guard on top of that, not replacing it. Confirm the layering — the time guard fires only inside the `sent` branch, never on `accepted` / `declined` / `draft`. (Probably yes; calling out so the test names match.)

3. **What should the rejection error message say?** Options: (a) `"This Quote has expired (valid for X days from send date — sent YYYY-MM-DD). Re-issue a new Quote with current pricing."` — explicit + actionable; (b) shorter `"Quote expired."` Recommend (a) — the action is rare enough that the verbose message helps the staff member figure out what to do.

4. **PDF "Valid until" vs "Valid for X days from issue"?** The PDF already prints `Issued: YYYY-MM-DD` (`render-quote.ts:192`). Adding an absolute "Valid until: YYYY-MM-DD" is unambiguous; adding "Valid for 30 days" leans on the reader to do the math. Recommend the absolute form. **Edge case:** if `quoteValidDays` is overridden per-quote (allowed by the schema), the rendered date must use the row's value, not the default — easy to get wrong if Phase 2 hardcodes "30 days".

5. **Email body wording** — "Please respond by YYYY-MM-DD to lock in this pricing." vs "This quote expires on YYYY-MM-DD." Recommend the first (action-oriented, less negative). Same `quoteValidDays`-per-row source.

6. **Pairing with 0026 follow-up (c) staff accept/decline UI?** That follow-up adds the UI buttons that surface `acceptQuote` / `declineQuote` to coaches today (they run via CLI). The expiry guard's "rejected" error path will be visible to the user only once that UI exists. Today the guard's error returns to the calling Server Action — only the audit-log + a coach-typed `acceptQuote` invocation surfaces it. Two paths: (i) ship 0044 standalone, accept that the error is CLI-visible for now, document the pairing in the follow-up list; (ii) bundle (c) into 0044's scope so the error has a UI surface. Recommend (i) — bundling makes 0044 large and (c) has its own design surface (which button states, where the buttons render). Keep them separate.

7. **Backfill / migration concerns for already-sent stale Quotes?** Production has a small population of Quotes (the post-0040 cleanup left `/quotes` `All (0)` — see CURRENT.md 2026-05-12 entry — but that may have changed). After Phase 1 ships, any pre-existing `sent` Quote older than its `quoteValidDays` window will refuse `acceptQuote`. Probably fine since the staff member is the one running `acceptQuote` and they can re-issue, but confirm against current prod state before merge.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Expiry guard inside `markQuoteAccepted` (lifecycle helper) | `src/features/quotes/lifecycle.ts:69` (`markQuoteAccepted` itself) | Add the time check inside the existing helper — sibling shape, same I/O contract. Returns `{ ok: false, error: '...' }` on the new failure branch alongside the existing non-`sent`-status branch. |
| `acceptQuote` Server Action error propagation | `src/features/quotes/actions.ts:825` (the action's existing error-return branches) | The action already returns `{ error: '...' }` from `markQuoteAccepted` — Phase 1 adds nothing here; the new error flows through the existing pipe. |
| `loadQuote` projection extension (Phase 3 option B) | `src/features/quotes/queries.ts` (existing `loadQuote` shape; same as 0040 P2 anchor `actions.ts:683-704` / `queries.ts:50-52`) | Add a computed `isExpired` boolean projected at read time. Sibling to how `loadQuote` already projects derived fields. |
| PDF "Valid until: YYYY-MM-DD" line | `src/lib/pdf/render-quote.ts:192` (the `Issued: ${quote.issuedDate}` line) | Sibling line directly below "Issued:". `QuoteData` type (`render-quote.ts:13-25`) extended with `validUntilDate: string`. |
| Email "Please respond by YYYY-MM-DD" line | `src/lib/email/templates/quote.tsx:104` (the subject + body block) | The template's `QuoteEmailFields` type takes a `quoteNumber`, etc. — add `validUntilDate: string`. Caller (`sendQuote` in `actions.ts:714`) passes the computed value. |
| `acceptQuote` test cases for expiry guard | `src/features/quotes/actions.test.ts:268` (existing `acceptQuote` test block) | Sibling tests in the same file; vitest mocks already set up for `quotes` / `audit_log` / `dealers`. |
| (Option A only) `quote.expired` audit-action enum value | `drizzle/0019_msa_audit_actions.sql` (precedent for `ALTER TYPE … ADD VALUE` on the `auditAction` enum) | Same migration pattern; sibling action values (`quote.accepted` / `quote.declined`) already in the enum. |
| (Option A only) Nightly sweep script `scripts/0044-quote-expiry-sweep.ts` | `scripts/0041-msa-smoke.ts` (script-with-subcommands shape) | Same Drizzle-`db` import shape, same `insert | cleanup`-style subcommand surface; sweep would have a single `run` subcommand. |
| (Option A only) `quote_status` enum extension migration | `drizzle/0019_msa_audit_actions.sql` (same `ALTER TYPE` precedent) | Same `pgEnum` extension pattern; project's existing `db:generate` workflow handles the snapshot. |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — the "Quote expired before acceptance" paragraph (line 72) is the existing design intent; this plan implements it.
- `docs/wiki/data-model.md` lines 401–405 — `quotes.quote_valid_days` column definition + CHECK constraint.
- `CLAUDE.md` → "Mutations go through Server Actions" — the guard sits inside `markQuoteAccepted` (called from `acceptQuote` Server Action), not in a route handler.
- `docs/wiki/forms.md` (post-0042) — if Phase 3 picks Option (B) and the composer surface needs a derived-expired pill, it follows the in-house `STATUS_PILL_CLS` pattern (kept-in-house per the 0042 decision matrix).

**Note:**
- Each phase includes both implementation and tests.
- Phase 3 is the decision-and-implement phase — its scope is determined by OQ #1's resolution.
- Phase 4 is conditional: skipped entirely if Phase 3 picks Option (B); becomes a real phase if (A) or (C).
- Phase 5 is the chunk-end full `/eval` (per the post-0040 `/build` cadence — fast `tsc + test` per phase, Codex + web-test + lint at chunk-end).

### Phase Checklist

#### Phase 1: `acceptQuote` expiry guard

The minimum behavior fix. Refuses staff `acceptQuote` on stale Quotes, regardless of how OQ #1 resolves later.

- [x] Extend `markQuoteAccepted` in `src/features/quotes/lifecycle.ts` to compute `expiresAt = sentAt + quoteValidDays days` after the existing `status='sent'` load and before the atomic guarded UPDATE. Add a new failure branch returning `{ ok: false, error: '<message from OQ #3>' }` when `expiresAt < now()`. (Implementation note: introduced a fresh pre-load round-trip `SELECT status, sent_at, quote_valid_days` before delegating to `transition()`; guard skips when `status !== 'sent'` so idempotent/illegal-source paths stay race-handled by the existing UPDATE-then-reselect.)
- [x] Confirm the existing atomic UPDATE still gates on `status='sent'` — the time guard is layered, not a replacement (per OQ #2).
- [x] No changes to `acceptQuote` itself (`actions.ts:825`) — the new error propagates through the existing `{ error: '...' }` return.
- [x] Test case 1: send a Quote with `quoteValidDays = 30`, advance time 31 days, call `acceptQuote`, expect `{ error: <expired message> }` + no row update + no audit emission. *(Used `sentAt = now() - 31d` rather than mocking `Date.now()` — same effect, cleaner test.)*
- [x] Test case 2: same setup with 29 days, expect `{ ok: true }` + row flips + audit emission (regression coverage for the happy path).
- [x] Test case 3: per-row `quoteValidDays = 7` override on a Quote sent 8 days ago — refuses (regression for OQ #4's per-row source).
- [x] Test case 4: idempotent re-accept on an already-`accepted` Quote — covered by the existing "is idempotent on already-accepted" test (now extended with the pre-load row whose `status='accepted'` causes the expiry guard to be skipped).
- [x] `tsc + test` gate green. (tsc clean, 760/762 tests pass — was 757; +3 new expiry-guard tests.)

#### Phase 2: Surface validity on PDF + email

- [ ] Extend `QuoteData` type in `src/lib/pdf/render-quote.ts:13-25` with `validUntilDate: string` (ISO `YYYY-MM-DD`).
- [ ] Compute `validUntilDate` at the PDF render call site (`actions.ts:596` + `:714`) from `sentAt + quoteValidDays`. **Don't hardcode 30** — use the row's value (OQ #4).
- [ ] Add a "Valid until: YYYY-MM-DD" line in the renderer sibling to "Issued: ..." (`render-quote.ts:192`).
- [ ] Extend `QuoteEmailFields` type in `src/lib/email/templates/quote.tsx` with `validUntilDate: string`. Update `sendQuote` (`actions.ts:714`) to pass it.
- [ ] Add "Please respond by YYYY-MM-DD to lock in this pricing." line in the email body (OQ #5 wording).
- [ ] Test case 1: `renderQuotePdf` snapshot extends to assert the new "Valid until" line is rendered.
- [ ] Test case 2: send-flow test (`actions.test.ts`) asserts the email template receives the computed `validUntilDate`.
- [ ] Test case 3: per-row `quoteValidDays = 14` override flows through — PDF + email both reflect 14, not 30.
- [ ] `tsc + test` gate green.

#### Phase 3: Resolve OQ #1 → implement chosen lifecycle path

**Block on OQ #1.** Don't pick a path mid-phase; the choice changes scope materially.

- [ ] Reach decision on OQ #1 (A enum + sweep / B derived field / C `expired_at` timestamp). Default-recommend (B); promote to (A) only if the staff accept/decline UI lands first (0026 follow-up (c)) and exposes the rendering surface for an Expired pill.

**If Option (B) — recommended v1 default:**
- [ ] Project `isExpired = status === 'sent' && sentAt + quoteValidDays < now()` from `loadQuote` (`src/features/quotes/queries.ts`).
- [ ] Update the composer header pill (`/quotes/[id]`) and the `/quotes` index column to render a derived "Expired" state when `isExpired` is true.
- [ ] No schema migration. No sweep. Phase 4 is skipped.
- [ ] Test case 1: round-trip a `sent` Quote past its window — `loadQuote` returns `isExpired: true`.
- [ ] Test case 2: an `accepted` Quote past its sent + valid_days date returns `isExpired: false` (status precedence).

**If Option (A) — full enum + sweep:**
- [ ] Drizzle schema edit + `pnpm db:generate` → `drizzle/00NN_<slug>.sql` extends `quote_status` enum with `'expired'` via `ALTER TYPE … ADD VALUE` (precedent: `drizzle/0019_msa_audit_actions.sql`).
- [ ] `auditAction` enum extension: add `quote.expired` via the same `ALTER TYPE` pattern.
- [ ] UI: every place that switches on Quote status handles the new value (`STATUS_PILL_CLS` block + `/quotes` filter pills + composer header).
- [ ] Tests + migration journal `when` bump per db-conventions skill.
- [ ] Phase 4 runs (sweep job).

**If Option (C) — `expired_at` timestamp:**
- [ ] Schema add: `quotes.expired_at timestamptz NULL` (no CHECK; sweep populates).
- [ ] UI infers expired state from `expiredAt != null`. Mostly mirrors Option (B) on the read side; differs on the write side (Phase 4 populates instead of derive-on-read).
- [ ] Phase 4 runs (sweep populates).

- [ ] `tsc + test` gate green.

#### Phase 4: Nightly sweep job (conditional)

**Skipped if Phase 3 picked Option (B).** Implemented for (A) or (C).

- [ ] `scripts/0044-quote-expiry-sweep.ts` with a `run` subcommand. Loads all `sent` Quotes; for each whose `sentAt + quoteValidDays < now()`, atomically flip to `expired` (Option A) or set `expired_at = now()` (Option C). Emits a `quote.expired` audit row (Option A) per row.
- [ ] Anchor: `scripts/0041-msa-smoke.ts` shape (script-with-subcommands).
- [ ] No cron infrastructure exists today — the script is runnable on demand. Document the cadence (recommend manual until the project gets a scheduler).
- [ ] Test case 1: `run` against a fixture with one stale `sent` Quote + one fresh `sent` Quote → only the stale one flips.
- [ ] Test case 2: idempotent re-run on already-expired rows → no audit duplication.
- [ ] `tsc + test` gate green.

#### Phase 5: Tests + smoke verification

- [ ] Full `pnpm test` — all existing Quote tests still pass (`acceptQuote` happy path, `sendQuote` round-trip, `loadQuote` projection).
- [ ] Smoke (web-test) `/quotes/new?dealerId=1` → fill in inputs, save draft — composer behavior unchanged.
- [ ] Smoke (web-test) `/quotes/[id]` on a stale fixture (insert via `scripts/0044-quote-expiry-fixture.ts insert` if a fixture is needed) → verify the derived "Expired" pill renders (Option B) OR the status badge reads "Expired" (Option A); the PDF preview iframe shows the "Valid until: YYYY-MM-DD" line.
- [ ] If Option (A) or (C) shipped: run `pnpm dlx tsx scripts/0044-quote-expiry-sweep.ts run` against the fixture to confirm the flip happens end-to-end.
- [ ] Cleanup: `scripts/0044-quote-expiry-fixture.ts cleanup` removes the fixture rows (sibling to `scripts/0040-cleanup-quote-1.ts` and `scripts/0041-msa-smoke.ts cleanup`).
- [ ] Full `/eval` at chunk-end (single pass per post-0040 `/build` cadence — fast `tsc + test` per phase, Codex + web-test + lint at chunk-end only).
