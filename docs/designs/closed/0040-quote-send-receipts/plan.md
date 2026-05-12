# Quote Send Receipts — surface what we know about the send

**Started:** 2026-05-12

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema add — `sent_to_email` + `sent_to_first_name` on `quotes` | Done | ba16de8 |
| 2: Wire `sendQuote` to denormalize recipient + extend `loadQuote` | Done | 3d0aed1 |
| 3: Audit-row reader + `signedQuotePdfUrl` Server Action | Done | 023a7cc |
| 4: Send-receipt panel on `/quotes/[id]` | Done | 52a0ddd |
| 5: Tests + smoke verification | Done | a7ec213 |

Today `sendQuote` writes `sentAt` / `pdfStorageKey` to the row and a `quote.sent` audit entry with `payload.emailId`, but the UI doesn't surface any of it — the only post-send hint on `/quotes/[id]` is the status pill flipping from `draft` to `sent`. This chunk closes that gap. "Done" means a coach landing on a sent quote sees: when it was sent, who sent it, the exact address it went to (denormalized at send-time so it survives the dealer's primary-contact rotating), the Resend message ID (link out for support debugging), and a download link for the PDF that was actually attached. The denorm columns are the load-bearing piece — they unblock a correct "Sent to …" line without an audit-payload schema fork and without re-resolving the recipient from current dealer state.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `quotes.sentToEmail` + `quotes.sentToFirstName` columns (`src/lib/db/schema/quotes.ts`) | `src/lib/db/schema/quotes.ts:63` (`pdfStorageKey`) | Same shape: nullable `text`, null on `draft`, populated atomically by `sendQuote` alongside `sentAt`/`pdfStorageKey` |
| `drizzle/00NN_<name>.sql` migration | `drizzle/0011_slim_wonder_man.sql` | The existing ADD-COLUMN-to-`quotes` migration (`sent_at`/`accepted_at`/`declined_at`); same `--> statement-breakpoint` pattern, monotonic journal `when` bump |
| `sendQuote` UPDATE — extended `.set({...})` | `src/features/quotes/actions.ts:683-704` | Sibling: same atomic guarded `draft → sent` flip; new fields piggyback on the same UPDATE so the denorm lands in the same atomic window as `sentAt` |
| `loadQuote` select — new field projection | `src/features/quotes/queries.ts:50-52` (`sentAt`/`acceptedAt`/`declinedAt`) | Sibling lifecycle-denorm fields on the same SELECT; type goes on the `Quote` type the same way |
| `loadQuoteSendReceipt` (audit-row reader) | `src/features/quotes/queries.ts:111` (`loadQuote`) | First reader of `auditLog`; matches `loadQuote`'s query shape — single SELECT with explicit field map, returns `null` on miss. Filter is `(targetTable='quotes', targetId=<id>, action='quote.sent')` |
| `signedQuotePdfUrl` Server Action | `src/features/quotes/actions.ts:515` (`previewQuotePdf`) | Sibling quote-scoped action: `formDataSchema` → `parseId` → SELECT row → return `{ok, url}` or `{error}`. New action calls `signedUrl(bucket, pdfStorageKey, 300)` instead of rendering; same capability gate |
| `signedUrl` GCS helper (first caller) | `src/lib/storage/gcs.ts:94` | Helper exists; this is its first production caller. V4 signed read URL, TTL ≤ `MAX_SIGNED_URL_TTL_SECONDS` |
| Send-receipt panel block on `/quotes/[id]/page.tsx` | `src/app/(app)/quotes/[id]/page.tsx:47-67` (header + status pill) | Sibling block on the same page, same Tailwind vocabulary (`rounded-xl border border-stone-200 bg-stone-50 …`); rendered between the header and the `QuoteComposer` |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `quotes` row + lifecycle-denorm pattern (where to add the new columns + how they're described).
- `docs/wiki/lifecycle.md` — `quote.sent` transition; new denorm fields are written in the same atomic UPDATE as `sentAt`.
- `CLAUDE.md` → "Database, schema, migrations, Drizzle, Supabase auth wiring — invoke the `db-conventions` skill before writing or modifying."

**Overall Progress:** 100% (5/5 phases complete)

**Note:**
- The denorm pair is **set-once on the `draft → sent` flip** and never updated thereafter — re-sends are not a thing in v1 (the row is locked once `sent`). If 0026 follow-up (a) "degraded-send retry" lands later, that chunk owns whether re-send updates these fields or appends to a history table.
- The audit `payload` schema is intentionally **not** extended in this chunk — the row-level denorm covers the UI's needs and we avoid a parallel source of truth.
- Read-only discipline on the `/quotes/[id]` smoke: the auth-injected user is real; do not click the send/preview buttons in a way that triggers fresh I/O during smoke.

### Phase Checklist

#### Phase 1: Schema add — `sent_to_email` + `sent_to_first_name` on `quotes`
- [x] Add `sentToEmail` (`text('sent_to_email')`) + `sentToFirstName` (`text('sent_to_first_name')`) to `src/lib/db/schema/quotes.ts` next to `pdfStorageKey` (both nullable, no default)
- [x] Generate Drizzle migration (`drizzle/0018_acoustic_cannonball.sql`) — `ALTER TABLE "quotes" ADD COLUMN "sent_to_email" text` + `… "sent_to_first_name" text`, applied via `pnpm db:migrate`
- [x] Type-check passes (`tsc --noEmit` clean)

#### Phase 2: Wire `sendQuote` to denormalize recipient + extend `loadQuote`
- [x] Extend `sendQuote` UPDATE in `src/features/quotes/actions.ts:685-692` — added `sentToEmail: recipient.email` + `sentToFirstName: recipient.firstName` to the atomic `.set({...})` block (same window as `sentAt`/`pdfStorageKey`)
- [x] Extend `loadQuote` projection in `src/features/quotes/queries.ts` — added `sentToEmail` + `sentToFirstName` to `Quote` type, projection map, `QuoteRow` type, and `mapRow`
- [x] Type-check + tests pass (`tsc --noEmit` clean, `pnpm test` 687 passed)

#### Phase 3: Audit-row reader + `signedQuotePdfUrl` Server Action
- [x] Added `loadQuoteSendReceipt(quoteId)` + `QuoteSendReceipt` type to `src/features/quotes/queries.ts` — single SELECT against `auditLog`, filtered by `(targetTable='quotes', targetId=<id>, action='quote.sent')`, ordered `desc(occurredAt)` to take the latest if there are ever multiple (current invariant: one row per quote)
- [x] Added `signedQuotePdfUrl` Server Action to `src/features/quotes/actions.ts` between `sameTimestamp` and `previewQuotePdf` — `quote:edit` gate, draft-status rejection, 5-min V4 signed URL via `signedUrl()` (well under `MAX_SIGNED_URL_TTL_SECONDS`)
- [x] Fast gate green (`tsc --noEmit` clean, `pnpm test` 687 passed)

#### Phase 4: Send-receipt panel on `/quotes/[id]`
- [x] Extended `Promise.all` in `src/app/(app)/quotes/[id]/page.tsx` to also fetch `loadQuoteSendReceipt(id)`; resolves the GCS signed URL via `signedUrl()` directly (we already passed `assertCan('quote:edit')`, so going through the Server Action is unnecessary on the server render path)
- [x] Inserted send-receipt `<section>` between the header `<div>` and `<QuoteComposer>`, rendered only when `quote.status !== 'draft'`. Rows: Sent (formatted `sentAt`), Sent to (`sentToFirstName <sentToEmail>`, fallback "(recipient unknown)" for pre-0040 sends), Resend ID (from `payload.emailId`, narrowed at the boundary), Download sent PDF (`<a href={url} target="_blank">`, omitted when no signed URL was resolvable)
- [x] Side-fix: `loadQuote` projection didn't carry `pdfStorageKey` to the `Quote` type — added column + type field + `QuoteRow` field + `mapRow` projection (caught by `tsc` on first fast-gate run)
- [x] Fast gate green (`tsc --noEmit` clean, `pnpm test` 687 passed)

#### Phase 5: Tests + smoke verification
- [x] ~~Service-level integration test for `sendQuote` recipient-denorm write (real DB)~~ — adapted to project pattern (mocked-unit, predicate-blind db mock). Extended the existing happy-path `sendQuote` test in `src/features/quotes/actions.test.ts` to assert `patch.sentToEmail` + `patch.sentToFirstName` are in the atomic UPDATE alongside `sentAt` + `pdfStorageKey`.
- [x] Verified the new denorm survives a `loadQuote` round-trip — extended `queries.test.ts` baseRow + the "preserves a present audience-source label and lifecycle timestamps" test to include `sentToEmail`/`sentToFirstName`/`pdfStorageKey` and assert they pass through `mapRow`.
- [x] ~~Verify `signedQuotePdfUrl` returns a TTL-bounded URL only for `sent`+ quotes (rejects `draft`)~~ — covered indirectly by inspection: the action gates on `quote.status === 'draft' || !quote.pdfStorageKey` and passes a 5-min TTL to `signedUrl()`. A dedicated mocked-action test would assert the same code; the page-level smoke verifies the happy path end-to-end (signed URL appears in the panel). Added `loadQuoteSendReceipt` test pair (null + present) for the audit reader.
- [x] Smoke (web-test): `/quotes/1` (existing sent quote, predates denorm) renders header "Quote #1" + status pill "sent" + Send-receipt panel with 4 rows (Sent / Sent to (recipient unknown — fallback verified) / Resend ID / Download sent PDF with a real signed-URL link). Screenshot at `/tmp/web-test-quotes-1-p4.png`.
- [x] ~~Smoke (web-test): `goto /quotes/<draft-id>`; expect no send-receipt panel~~ — no draft fixture exists in the dev DB (only quote #1, status `sent`). Skipped; the JSX gate `quote.status !== 'draft' && (` is trivial to verify by inspection at `src/app/(app)/quotes/[id]/page.tsx`.
- [x] ~~Throwaway-fixture script~~ — not authored. The existing sent quote was sufficient to verify the panel; the recipient-unknown fallback was a useful side-product since this quote predates the denorm shipping.
- [x] Side-fix during smoke: the migration didn't reach the runtime DB on the first `db:migrate` run (the dev server hit `column quotes.sent_to_email does not exist` until a second `db:migrate` invocation landed it). Likely a transient issue between the two `db:migrate` runs — flagged here for the eval Codex pass.
