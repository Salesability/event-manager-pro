# Quote Attachments — Local Upload (v1) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-12

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema + storage scheme (`quote_attachments` spine) | Done | `42d8259` |
| 2: Send-dialog upload UI + upload action | Done | `bbb03be` |
| 3: Wire uploaded attachments into `sendQuote` | Done | `49cba17` |
| 4: Tests + smoke + wiki | Done | - |

**Resolved owner decisions (2026-06-12):** file types = PDF + images (PNG/JPG/WEBP) + Office docs
(docx/xlsx); per-file cap **10 MB**, total-payload cap **20 MB** (quote PDF + all attachments);
retention = **keep forever in GCS** (no background GC; remove-before-send deletes the row, best-effort
deletes the object); gate = **same capability as sending the quote** (no new capability). See
[`intent.md`](intent.md) Open Questions.

When a coach sends a quote, the email should carry the quote PDF **plus** any files the coach
uploaded from their machine. The email layer already supports N attachments (`SendAttachment[]`,
`src/lib/email/send.ts:4`), so the work is: a place to store uploaded files (GCS + a
`quote_attachments` table), a UI on the send dialog to upload + remove them, and code in `sendQuote`
to fetch the selected bytes and append them to the `attachments` array. "Done" = a sent quote
arrives with the quote PDF and every uploaded document, the set persists for re-send, and an
over-size payload fails closed. **This chunk builds the attachment spine the 0079 document-library
chunk reuses** — so the schema + send-wiring are designed to extend (a nullable `document_id` FK is
added by 0079, not here).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length,
error handling, naming, query style, type patterns). For modifications to an existing file, the
anchor is the nearest sibling in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/quote-attachments.ts` — one row per uploaded file on a quote | `src/lib/db/schema/quote-line-items.ts:32` | Sibling child-of-`quotes` table: `quoteId` FK `onDelete: cascade`, self-contained snapshot columns, `bigIdentity`/`timestamps`/`actors`, per-quote index. |
| GCS put of an uploaded file | `src/features/quotes/actions.ts:1037` (`putObject`) | Same I/O — write a `Buffer` to the bucket, handle the `{ error }` union, then persist the key. |
| Upload + remove (detach) Server Actions | `src/features/quotes/actions.ts` (`sendQuote` + sibling guarded actions) | Same layer — capability-gated Server Action, zod input, `recordAudit`, `revalidate*`. Mutations are Server Actions, not route handlers (CLAUDE.md). |
| Append uploads into the send | `src/features/quotes/actions.ts:1064` (the `attachments: [...]` array) | The exact array we extend; `SendAttachment` already accepts N files — no email-layer change. |
| Upload section in the send dialog | `src/features/quotes/quote-composer.tsx` (the `confirmSendOpen` dialog) | The dialog we extend; RHF + zod + shadcn `<Field>` per [`forms.md`](../../../wiki/forms.md); dialog submit stays in `<DialogFooter>`. |
| File-upload control (`<input type="file">` → upload action) | *(no existing anchor — first file input in the repo)* | **Net-new for this codebase.** Landed as a `FormData`-with-`File` Server Action (not a signed-upload URL — the bytes are small, ≤10 MB, and the action already owns validation + the `quote_attachments` insert in one round-trip). Styled with Tailwind `file:` variants. |

**Landed in Phase 2 (not in the original map):**
| `src/features/quotes/attachments.ts` — shared MIME allowlist + caps + key/filename helpers + `QuoteAttachmentView` | `src/features/quotes/constants.ts` | A pure (no `'server-only'`) sibling module so the client pre-check and the server enforcement share one source of truth. |
| `deleteObject` in `src/lib/storage/gcs.ts` | `getObject` / `putObject` in the same file | Same `{ ok } \| { error }` union shape; `ignoreNotFound` so a re-delete is a no-op success. |
| `audit_action` enum append (`quote.attachment_*`) — `0039_quiet_blur.sql` | `drizzle/0019`, `0020` (`ALTER TYPE ADD VALUE`) | `recordAudit` writes a `pgEnum`; the two new actions needed the enum extended. Append-only, applied to sandbox. |

**Conventions referenced:**
- `docs/wiki/data-model.md` — column conventions (`bigIdentity`, `timestamps`, `actors`); FK `onDelete` discipline.
- `docs/wiki/forms.md` — RHF + zod + shadcn `<Field>`; dialog-level submit lives in `<DialogFooter>`.
- `docs/wiki/commercial-spine.md` — where the quote sits in the deal flow (why paperwork rides with it).
- **`db-conventions` skill** — invoke before writing/altering schema or generating the migration (Phase 1). Watch the Drizzle journal `when` gotcha when generating `--custom`.
- `src/lib/storage/gcs.ts` — `putObject` / `getObject` / `signedUrl` (GCS, **not** Supabase Storage). Max signed-URL TTL is 7 days.
- `src/lib/email/send.ts:4` — `SendAttachment { filename, content: Buffer, contentType? }`; `sendEmail` already maps an N-element array into Resend.

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration tests (real DB) come last, after all phases pass.
- Phase content below is a **first draft** derived from the code map — refine once the `intent.md`
  open questions (file types/caps, retention) are answered.

### Phase Checklist

#### Phase 1: Schema + storage scheme (`quote_attachments` spine)
- [x] `db-conventions` skill: confirm column/migration conventions before writing.
- [x] `quote_attachments` table — `bigIdentity`, `quoteId` FK (`onDelete: cascade`), self-contained snapshot columns (`filename`, `storageKey`, `contentType`, `byteSize`), `displayOrder`, `timestamps`, `actors`; index on `quoteId`. **No `document_id` column** — that's 0079's additive migration. (`src/lib/db/schema/quote-attachments.ts`, registered in `index.ts`.)
- [x] GCS key scheme for uploads: `quotes/{quoteId}/attachments/{uuid}-{filename}` (uuid avoids collisions on same-name re-uploads). Documented in the schema header; helper lands in Phase 2.
- [x] Generate migration (`0038_daily_azazel.sql`); verify journal `when` ordering (1781309007600 > 0037's 1781292323550 ✓); append standard RLS (service_role + staff, matching `quote_line_items`); apply to **sandbox** (✓ applied).

#### Phase 2: Send-dialog upload UI + upload action
- [x] Shared MIME allowlist + caps + key/filename helpers in `src/features/quotes/attachments.ts` (no `'server-only'` — client + server both import it so the pre-check can't drift). Added `deleteObject` to `src/lib/storage/gcs.ts`.
- [x] Server Action `uploadQuoteAttachment` (`actions.ts`): validate type + size (≤ 10 MB) + terminal-status guard + running-total cap → `putObject` → insert `quote_attachments` row (gated `quote:edit`, `recordAudit('quote.attachment_added')`, `revalidate`). Returns the inserted view-model row.
- [x] Server Action `removeQuoteAttachment` (`actions.ts`): guarded `DELETE … RETURNING` (by `id` + `quoteId`) → best-effort `deleteObject` → `recordAudit('quote.attachment_removed')`.
- [x] Loader `loadQuoteAttachments` in `queries.ts` for the dialog.
- [x] Extend the `confirmSendOpen` dialog in `quote-composer.tsx`: a "Documents" section with a multi `<input type="file">`, the current upload list (filename · size · Remove), client-side type/size/total pre-check, and a running total hint. Send disabled while uploading. Wired `initialAttachments` from `/quotes/[id]/page.tsx`.
- [x] **Audit enum:** `recordAudit` writes a `pgEnum` value — added `quote.attachment_added` / `quote.attachment_removed` to `audit_action` (migration `0039_quiet_blur.sql`, `ALTER TYPE ADD VALUE`, applied to **sandbox**). Mirrors the 0019/0020 enum-append precedent.
- [x] Test: 6 cases in `actions.test.ts` (upload happy-path inserts row + GCS key + audit; rejects unsupported type / over-cap / terminal quote; remove deletes row + object + audit; remove-not-found). Loader/list-reflects covered by the Phase 4 integration test.

#### Phase 3: Wire uploaded attachments into `sendQuote`
- [x] In `sendQuote`, after the quote PDF renders, load this quote's `quote_attachments` (ordered by `displayOrder`, id) — **before** the guarded UPDATE.
- [x] For each, `getObject` the bytes from GCS and push `{ filename, content, contentType }` onto the email `attachments` array (quote PDF first, uploads after).
- [x] **Total-size guard:** sum quote PDF byteLength + all attachment `byteSize`; if over **20 MB total**, fail closed **before** the status transition (no half-send). Checked from row sizes (cheap) before any byte fetch.
- [x] A missing/unreadable GCS object fails the send with a repairable "remove and re-upload" message — and, being pre-transition, leaves the row sendable (better than the post-transition degraded PDF-upload path).
- [x] Extended the `quote.sent` audit payload with `attachmentCount` + `attachments[]` (filename + byteSize) denorm.
- [x] Test: 2 new `sendQuote` cases (PDF + 2 uploads → 3 email attachments + audit denorm; over-cap set fails closed before the transition). Made the db mock's `select` table-aware so `quote_attachments` reads pull from a dedicated `attachmentResults` queue (zero churn to the 15 existing sendQuote tests).

#### Phase 4: Tests + smoke + wiki
- [x] Integration test (real DB, rolled back): `tests/integration/quote-attachments.test.ts` — the loader's `ORDER BY display_order` against real Postgres + a re-read returning the same set (re-send re-attaches). *(The full `sendEmail` payload + audit denorm assertions live in the Phase 3 unit tests — richer/faster with mocked GCS+email; the integration test proves the real-DB schema/loader the mocks can't.)*
- [x] Integration test: re-send re-attaches the persisted set without re-uploading (second read returns the same rows) + FK **CASCADE** drops attachments when the parent quote is deleted.
- [~] Smoke (web-test): `goto /quotes/<id>`; click "Send Quote"; dialog shows a **Documents** section with a file-upload control — **deferred to the chunk-end `/eval`** (the build skill runs browser smoke there, not per-phase). Read-only; do not click upload/send on the gated surface.
- [x] ~~Smoke seed script~~ — not needed; the chunk-end `/eval` web-test auth-injects and navigates to an existing sandbox quote. No new DB state required to render the Documents section.
- [x] Wiki ingest: `data-model.md` (ERD edge + `quote_attachments` entity block + summary row + relationships entry), `commercial-spine.md` (new "Supporting documents on the quote email" subsection), `log.md` entry.
