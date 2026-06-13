# Quote Document Library ("from the system") — Intent

**Created:** 2026-06-12
**Status:** Deferred (`future/`). Un-defer trigger — **0078 (local upload) ships** AND the owner
makes the two product calls below (delivery sensitivity + library scope). See the plan header.

## Problem

[`0078-quote-attachments`](../../closed/0078-quote-attachments/intent.md) lets a coach upload a one-off file
from their machine and attach it to a quote. But the owner also wants to *"draw from system"* — a
**reusable** set of documents (the standard banking-info sheet, a registration form, a waiver) that
an admin uploads **once** and any coach can attach to **any** quote without re-uploading. Without
this, the banking-info PDF has to be re-uploaded by hand on every single quote — exactly the manual,
error-prone step the feature is meant to remove for the recurring documents.

## Desired outcome

An admin maintains a small **document library** (upload, list, archive). On the quote send dialog,
the "Documents" section — already built by 0078 — gains a **picker**: a checkbox list of the
non-archived library documents. A coach checks the ones to include, and they're attached to the
outgoing email exactly like an uploaded file, reusing 0078's spine (`quote_attachments` → GCS fetch →
`sendEmail` attachments array). Re-send re-attaches the same set.

## Non-goals

- **The attachment spine + delivery + local upload** — all built by 0078; this chunk is purely
  additive (a `documents` table, an admin surface, and the picker half of the dialog).
- **Library versioning / approval workflow.** v1 of the library is upload + archive, nothing more.
- **Fillable / e-signed library forms.** Static documents only; sign-back stays the BoldSign path.

## Success criteria

- An admin can upload a reusable document, see it listed, and archive it (archived = hidden from the
  picker but existing `quote_attachments` snapshots stay valid).
- The send dialog's "Documents" section lists non-archived library documents as a checkbox picker.
- Checking a library document attaches it to the sent quote email alongside the quote PDF + any local
  uploads; the selection persists for re-send.

## Open questions (the un-defer decisions)

1. **Delivery sensitivity — attachment vs signed link.** Banking instructions as a plain email
   attachment aren't end-to-end encrypted. Acceptable, or should sensitive library documents go as a
   short-lived **signed-URL link** in the email body (`signedUrl()`, `src/lib/storage/gcs.ts:94`)?
   Could be a per-document `deliver_as: attachment | link` flag.
2. **Library scope.** Global (one shared library for the whole org) or scoped (per coach? per
   client/MSA)? Banking info is likely global; some forms might be client-specific.
3. **Who manages the library** — an admin gate (like other `/admin/*` surfaces), confirmed.

## Why now / why deferred

The reusable library is the higher-value half of the owner's ask (banking info is inherently
reusable), but it sits on top of 0078's spine and carries product decisions 0078 doesn't need. Build
the spine + local upload first (lower risk, no blocked decisions), then layer the library on once the
delivery + scope calls are made.
