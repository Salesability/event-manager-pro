# Quote Document Library ("from the system") — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _not started_

> **DEFERRED — `future/` (since 2026-06-12).** This chunk is **not on the runway**. It is additive on
> top of [`0078-quote-attachments`](../../closed/0078-quote-attachments/plan.md) (the attachment spine + local
> upload). **Un-defer trigger:** 0078 ships **and** the owner answers the two product calls in
> `intent.md` — (1) delivery sensitivity (attachment vs signed link for banking info) and (2) library
> scope (global vs per-client). When un-deferring, `mv` this folder back to `docs/chunks/` top level
> and reverse the cross-ref sweep (CLAUDE.md → "Un-deferring").

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: `documents` table + `quote_attachments.document_id` (additive migration) | Pending | - |
| 2: Document-library admin (upload / list / archive) | Pending | - |
| 3: Library picker in the send dialog | Pending | - |
| 4: Tests + smoke + wiki | Pending | - |

A reusable, admin-managed document library whose entries can be attached to a quote from the send
dialog, reusing 0078's spine unchanged. "Done" = an admin can curate the library and a coach can
check library documents to include them in the sent quote email. The delivery path (GCS fetch →
`sendEmail` attachments array → size guard) is **already built by 0078** — this chunk only adds the
*source* of the bytes, plus the optional `deliver_as` branch if the owner picks signed-link delivery.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/documents.ts` — reusable library table (GCS key + metadata) | `src/lib/db/schema/master-service-agreements.ts:22` | Same layer/shape — a table whose row points at a stored PDF via a `*StorageKey` text column. |
| `quote_attachments.document_id` — nullable FK to `documents` | 0078's `src/lib/db/schema/quote-attachments.ts` | Additive column on the spine 0078 built; `set null` so archiving/deleting a library doc never orphans a sent-quote snapshot. |
| Library upload / list / archive Server Actions | `src/features/quotes/actions.ts` (gated sibling actions) + 0078's upload action | Same layer; reuse 0078's GCS `putObject` + audit shape. |
| Document-library admin page | `src/app/(app)/admin/lookups/page.tsx` | Closest admin-management surface (server page + gated mutations + list/archive shape). Add a gate-matrix row. |
| Library picker in the send dialog | 0078's "Documents" section in `src/features/quotes/quote-composer.tsx` | Extends the section 0078 built; checkbox list per [`forms.md`](../../../wiki/forms.md). |
| (If signed-link delivery) link branch in `sendQuote` | `src/lib/storage/gcs.ts:94` (`signedUrl`) + 0078's send-wiring | Only built if Open Question 1 → link; else library docs flow through 0078's attachment path unchanged. |

**Conventions referenced:**
- `docs/wiki/data-model.md` — column conventions; archive-don't-delete to keep snapshots valid.
- `docs/wiki/forms.md` — admin form + dialog picker conventions.
- `docs/wiki/commercial-spine.md` — why supporting paperwork rides with the quote.
- **`db-conventions` skill** — the `documents` table + the additive `document_id` migration.

**Overall Progress:** 0% (0/4 phases complete) — **deferred, not started.**

### Phase Checklist (sketch — refine on un-defer)

#### Phase 1: `documents` table + additive migration
- [ ] `documents` table: `bigIdentity`, `name`/`label`, `storageKey` (GCS), `contentType`, `byteSize`, `deliverAs` (if Open Question 1 → per-doc flag), `archivedAt`, `timestamps`, `actors`.
- [ ] Add nullable `document_id` FK (`set null`) to `quote_attachments`.
- [ ] Migration; apply to sandbox.

#### Phase 2: Document-library admin
- [ ] Upload action → `putObject` (`documents/{id}/{filename}`) → insert row (gated, audited).
- [ ] Archive action (set `archivedAt`; never hard-delete).
- [ ] Admin UI: list + upload + archive; gate-matrix row.

#### Phase 3: Library picker in the send dialog
- [ ] Loader: non-archived library documents.
- [ ] Checkbox picker in 0078's "Documents" section; checking one creates a `quote_attachments` row (snapshot + `document_id` set).
- [ ] (If signed-link delivery) render sensitive docs as a body link instead of an attachment.

#### Phase 4: Tests + smoke + wiki
- [ ] Test: picking a library doc attaches it on send; archive hides it from the picker but keeps sent snapshots valid.
- [ ] Smoke (web-test): admin library page lists documents; send dialog shows the picker. *(Read-only on the gated surface.)*
- [ ] Wiki: `data-model.md` (`documents` + the new FK) + `log.md`.
