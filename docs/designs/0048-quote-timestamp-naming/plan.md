# Rename quotes by timestamp — display name + PDF filename

**Started:** 2026-05-13

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Shared `quoteDisplayName(createdAt)` helper + format decision | Done | - |
| 2: UI surfaces — composer header, MSA dialog, email body | Done | - |
| 3: PDF + email — body title, subject, attachment filename | Pending | - |
| 4: Tests + smoke verification | Pending | - |

Quotes are identified today as `Quote #<id>` everywhere they surface (composer header at `/quotes/[id]`, the MSA-create dialog, the emailed PDF body, the email subject, the email body, and the attachment filename `quote-<id>.pdf`). The user wants the display name reshaped to `quote-<timestamp>` and the download filename to `saledayevents-quote-<timestamp>.pdf`. "Done" is: every place that currently shows `Quote #<id>` shows the timestamp form instead; the PDF attachment lands in inboxes as `saledayevents-quote-<timestamp>.pdf`; the row's `id` is no longer user-visible (kept as the DB key, not the brand identity). No schema change — the timestamp derives from the existing `createdAt` column via a single helper, so renaming is reversible and zero-migration.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/quotes/display-name.ts` — exports `quoteDisplayName(createdAt: Date): string` returning `quote-YYYYMMDD-HHmm`, plus `quoteDownloadFilename(createdAt)` returning `saledayevents-quote-YYYYMMDD-HHmm.pdf` | `src/features/quotes/status-display.ts:1-30` | Same layer (pure display helper colocated with the feature), same shape (single small file, one or two exports + a tiny test sibling) — `status-display.test.ts` is the test-sibling template |
| `src/features/quotes/display-name.test.ts` | `src/features/quotes/status-display.test.ts:1-40` | Direct sibling — same test runner, same import path style, same coverage shape (a handful of representative inputs, not exhaustive) |
| Edit composer-page header to use `quoteDisplayName` | `src/app/(app)/quotes/[id]/page.tsx:180` (`pageTitle={Quote #${quote.id}}`) | Single line to replace; `quote.createdAt` is already on the query result projected above this line |
| Edit MSA-create dialog quote reference | `src/features/msa/msa-create-dialog.tsx:121` (`Quote #{props.firstDraftQuoteId}`) | Props currently only carry `firstDraftQuoteId`; add `firstDraftQuoteCreatedAt` upstream and pass it through (mirror the existing prop-pair shape) |
| Edit PDF body title | `src/lib/pdf/render-quote.ts:184` (`page.drawText(`Quote #${quote.quoteNumber}`, …)`) | The `quote` arg passed to `renderQuotePdf` already includes `createdAt` (it's a `QuoteRow`); compute name from that, drop the `quoteNumber` plumbing if no other caller needs it |
| Edit email subject + inline `(Quote #N)` | `src/lib/email/templates/quote.tsx:31, 83, 111` | The template takes `QuoteEmailFields`; add `createdAt: Date` to the field shape and replace `quoteNumber` (or keep both as a transitional alias and remove in Phase 3) |
| Edit PDF attachment filename | `src/features/quotes/actions.ts:982` (`filename: quote-${quoteId}.pdf`) | One-line swap to `quoteDownloadFilename(draft.createdAt)`; `draft` is already loaded on the same code path |
| Update existing assertions in `actions.test.ts` | `src/features/quotes/actions.test.ts:178, 332` (`'Your Salesability Quote — Quote #42'`) | Mirror the existing assertion style — fix to the new subject shape with a stubbed `createdAt` |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `quotes.id` remains the DB key; display identity is a derived view-layer concern, not a persisted column. No migration required for this chunk.
- `docs/wiki/auth.md` (n/a) — no gating change.

**Format decision (Phase 1):** `quote-YYYYMMDD-HHmm` in the project's display timezone (America/Toronto — the same `createdAt` is rendered elsewhere via `Intl.DateTimeFormat`). Filename-safe (no colons / spaces / slashes), human-readable, lexicographically sortable. Seconds omitted to keep the name short; collision risk is negligible at quote-creation rates. Phase 1's first task is to confirm this exact format before any callsites change.

**Overall Progress:** 50% (2/4 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)

### Phase Checklist

#### Phase 1: Shared `quoteDisplayName` helper + format decision
- [x] Confirm format spec: `quote-YYYYMMDD-HHmm` in America/Toronto. Note locale + zero-padding + lower-case `quote-` prefix. Document the decision inline in `display-name.ts` as the single source of truth.
- [x] Add `src/features/quotes/display-name.ts` exporting `quoteDisplayName(createdAt: Date): string` and `quoteDownloadFilename(createdAt: Date): string`. Pure functions, no IO, no `Date.now()`. Filename helper composes `quoteDisplayName` + `'saledayevents-'` prefix + `'.pdf'` suffix.
- [x] Add `src/features/quotes/display-name.test.ts` — three or four representative cases (a fixed UTC instant rendered in America/Toronto, a DST-boundary instant, a zero-padding case like `00:05` → `0005`).
- [x] `pnpm tsc --noEmit` + `pnpm vitest run src/features/quotes/display-name.test.ts` clean.

#### Phase 2: UI surfaces — composer header + MSA dialog
- [x] `src/app/(app)/quotes/[id]/page.tsx:180` — replace `pageTitle={`Quote #${quote.id}`}` with `pageTitle={quoteDisplayName(quote.createdAt)}`. (`quote.createdAt` is already on the query result; verify upstream selection if not.)
- [x] `src/features/msa/msa-create-dialog.tsx:121` — switch from rendering `Quote #{firstDraftQuoteId}` to `{quoteDisplayName(firstDraftQuoteCreatedAt)}`. Update the dialog's props type to carry `firstDraftQuoteCreatedAt: Date` and thread it from the call site (search for `firstDraftQuoteId` callers).
- [x] `/quotes/new` page header (`src/app/(app)/quotes/new/page.tsx:37`) — leave `"New Quote"` as is (pre-save, no `createdAt` yet); confirm decision in plan body.
- [ ] ~~Test case: render `/quotes/[id]` page-header smoke and assert the new title shape (`quote-20260513-1430` for a fixed `createdAt`).~~ Deferred to Phase 4's web-test smoke (no component-test harness for server-rendered pages in this repo).
- [ ] ~~Test case: MSA-create dialog renders `quote-<timestamp>` when a draft quote exists.~~ Deferred to Phase 4's web-test smoke (RTL test scaffold for client-side dialogs not yet established).

#### Phase 3: PDF + email — body title, subject, attachment filename
- [ ] `src/lib/pdf/render-quote.ts:184` — replace `Quote #${quote.quoteNumber}` with `quoteDisplayName(quote.createdAt)`. Drop `quoteNumber` from the `QuoteRow` arg shape if no other caller reads it (grep `render-quote` callers — `actions.ts` is the only one).
- [ ] `src/lib/email/templates/quote.tsx` — replace `quoteNumber: string` field with `createdAt: Date` on `QuoteEmailFields`; rewrite subject (`:111`) and inline body reference (`:83`) to use `quoteDisplayName(createdAt)`. JSDoc on `:31` updated to reflect the new identity shape.
- [ ] `src/features/quotes/actions.ts:967-973` — call site: pass `createdAt: draft.createdAt` instead of `quoteNumber: String(quoteId)`.
- [ ] `src/features/quotes/actions.ts:982` — replace attachment `filename: `quote-${quoteId}.pdf`` with `filename: quoteDownloadFilename(draft.createdAt)`.
- [ ] Update `src/features/quotes/actions.test.ts:178, 332` subject assertions to match the new format (with a stubbed `createdAt` on the test fixture).
- [ ] `pnpm tsc --noEmit` + `pnpm vitest run src/features/quotes/` clean.

#### Phase 4: Tests + smoke verification
- [ ] Service-level integration test: send a quote with a known `createdAt` and assert `email.subject`, `email.attachments[0].filename`, and the PDF body title all use the same `quote-<timestamp>` form.
- [ ] Smoke (web-test): `goto /quotes/4`; expect the composer page-header heading to be `quote-<timestamp>` (the timestamp from quote 4's `createdAt`); confirm the `Send` / `Preview` / `Close` buttons still render on the action toolbar.
- [ ] Smoke (web-test): `goto /quotes`; expect the row for quote 4 to still link to `/quotes/4` (the row label is `Edit`, unchanged by this chunk — verify nothing on the list page references `Quote #N`).
- [ ] Smoke (web-test): on a dealership with a draft quote, open the MSA-create dialog from `/dealerships/[id]`; expect the quote reference inside the dialog to read `quote-<timestamp>` (no `#`).
- [ ] Cross-check: `grep -rn "Quote #" src/` returns no live callsites (test fixtures may keep their stubbed assertions, but no production code path).
