# Quote Send Receipts — surface what we know about the send

**Started:** 2026-05-12

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema add — `sent_to_email` + `sent_to_first_name` on `quotes` | Done | ba16de8 |
| 2: Wire `sendQuote` to denormalize recipient + extend `loadQuote` | Done | 3d0aed1 |
| 3: Audit-row reader + `signedQuotePdfUrl` Server Action | Pending | - |
| 4: Send-receipt panel on `/quotes/[id]` | Pending | - |
| 5: Tests + smoke verification | Pending | - |

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

**Overall Progress:** 40% (2/5 phases complete)

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
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Test case 1
- [ ] Test case 2

#### Phase 4: Send-receipt panel on `/quotes/[id]`
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

#### Phase 5: Tests + smoke verification
- [ ] Service-level integration test for `sendQuote` recipient-denorm write (real DB)
- [ ] Verify the new denorm survives a `loadQuote` round-trip
- [ ] Verify `signedQuotePdfUrl` returns a TTL-bounded URL only for `sent`+ quotes (rejects `draft`)
- [ ] Smoke (web-test): `goto /quotes/<sent-id>`; expect header "Quote #N" + status pill "sent" + send-receipt panel with `Sent <date>` / `Sent to <email>` / `Resend ID <id>` / `Download sent PDF` link
- [ ] Smoke (web-test): `goto /quotes/<draft-id>`; expect **no** send-receipt panel (status `draft`, no denorm to show)
- [ ] (If a freshly-sent fixture is needed for the panel smoke) author `scripts/0040-send-receipt-smoke.ts insert` / `cleanup` per the throwaway-fixture pattern (`scripts/calendar-clamp-smoke.ts`)
