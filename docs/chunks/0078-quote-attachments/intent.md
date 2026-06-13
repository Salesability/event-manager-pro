# Quote Attachments — Local Upload (v1) — Intent

**Created:** 2026-06-12

## Problem

When a coach sends a quote, the email carries exactly one thing: the rendered quote PDF
(`sendQuote` → `sendEmail` with a single-element `attachments` array,
`src/features/quotes/actions.ts:1064`). But a real deal often needs supporting paperwork to
travel *with* the quote — a registration/intake **form** to fill out, **banking / payment
instructions**, a waiver, a one-pager. Today the coach has no way to include those: they
either drop them into the quote PDF (they can't — it's a generated single page) or send a
separate email outside the app. That second email is manual, easy to forget, and leaves no
record on the quote.

## Scope split (v1 vs the library follow-up)

The owner named two sources: *"draw from system or from local hard drive."* These map to two
distinct builds that share one delivery spine, so they're split into two chunks:

- **0078 (this chunk) — local upload.** Builds the attachment **spine** (the `quote_attachments`
  table + GCS storage + the `sendQuote` wiring + the size guard) and its first consumer: uploading
  a one-off file **from the local hard drive** at send time. A complete, shippable "attach a file
  from your computer to a quote." Lowest-risk slice, no unresolved product decisions.
- **0079 (deferred, `future/`) — document library** ("from the system"). Purely additive on top of
  0078's spine: an admin-managed library of reusable documents (the standard banking-info sheet, a
  registration form) + a picker on the send dialog. Carries the product decisions 0078 doesn't need
  (banking-info delivery sensitivity, library scope). Un-deferred when 0078 ships and those decisions
  are made.

## Desired outcome

From the quote send dialog on `/quotes/[id]`, a coach can **upload one or more documents from their
local machine** and attach them to the outgoing quote email. The recipient receives a single email
carrying the quote PDF **plus** every uploaded document. The chosen set is **recorded on the quote**,
so a re-send carries the same documents and there's an audit trail of what went out. The spine this
builds is reused, unchanged, by the 0079 library picker.

## Non-goals

- **The document library / "from the system" source.** That's chunk **0079** (`future/`). 0078
  establishes the spine + storage it will reuse, but builds **no** `documents` table and **no** admin
  surface. The send dialog's library-picker half is 0079's.
- **E-signature / fillable forms.** These are static documents the recipient *receives*. The
  sign-back flow stays the BoldSign MSA path (`src/features/msa/`).
- **Collecting documents back from the customer** (no upload-from-portal / intake capture).
- **Replacing or editing the quote PDF itself.** The generated quote PDF is unchanged; uploads ride
  alongside it.
- **Per-recipient personalization / merge fields** inside the attached documents.

## Success criteria

- On `/quotes/[id]`, the send dialog lets the coach upload one or more local files before sending.
- Sending the quote delivers an email containing the quote PDF **and** every uploaded document as
  attachments — verified in the dev redirect inbox (`EMAIL_DEV_TO`).
- Uploads persist on the quote; a **re-send re-attaches** the same set without re-uploading.
- A coach can **remove** an upload before sending.
- Total attachment payload is guarded against Resend's size limit; an over-limit send **fails
  closed** with a clear message rather than a silent drop.

## Open questions — RESOLVED 2026-06-12 (owner)

1. ~~**Allowed file types + size caps.**~~ **PDF + images + common Office docs** (PDF; PNG/JPG/WEBP;
   docx/xlsx). **Per-file cap 10 MB; total-payload cap 20 MB** (quote PDF + all attachments) — comfortable
   headroom under Resend's ~40 MB ceiling after base64 inflation (~33%).
2. ~~**Retention of ad-hoc uploads.**~~ **Keep forever in GCS** (cheap, simplest). Remove-before-send
   still deletes the row (and may best-effort delete the GCS object); no background GC on quote
   delete/cancel for v1.
3. ~~**Who can attach.**~~ **Same gate as sending the quote** — the attach UI lives in the send dialog
   behind the same capability; **no separate capability**.

*(Deferred to 0079 — the library chunk: banking-info delivery sensitivity — attachment vs
short-lived signed link; library scope — global vs per-coach vs per-client; who manages the library.)*

## Why now

The owner asked for it directly: *"when we send a quote off, is it possible to attach additional
documents like forms and banking information — I could draw from system or from local hard drive."*
As the quote becomes the contract surface (the accepted quote *is* the contract — see
[`commercial-spine.md`](../../wiki/commercial-spine.md)), the supporting paperwork that closes a
deal needs to ride *with* the quote rather than as a disconnected side email. Local upload is the
fastest path to that capability and lays the spine the reusable library will sit on.
