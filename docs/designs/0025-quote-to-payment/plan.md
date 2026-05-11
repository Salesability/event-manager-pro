# Quote → Contract → Invoice → Payment loop — epic tracker — 2026-05-07

**Started:** 2026-05-07

Tracks the four-step billing loop that turns a booked event into signed legal docs, an invoice, and a paid status. Originally Phase 7 of `docs/designs/closed/0004-port-migration/plan.md` (umbrella closed 2026-05-11); split out on 2026-05-07 into its own epic because each leaf is its own external-integration chunk with its own data model, webhook surface, and idempotency story — and the loop now outlives the port-migration tracker.

Done = a campaign can be sent end-to-end through quote → contract → invoice → payment, with branded PDFs, an e-signed MSA archived, Stripe invoicing, and a `Paid` status that flips on the Stripe webhook.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 7.1: Quote (PDF + email send) | In flight | - |
| 7.2: Contract (Dropbox Sign + signed-PDF archive) | Pending | - |
| 7.3: Invoice (Stripe invoice from accepted quote) | Pending | - |
| 7.4: Payment (webhook + campaign status flip) | Pending | - |

**Overall Progress:** 0% (0/4 leaf chunks complete)

## Sub-plans

| # | Chunk | Plan |
|---|-------|------|
| 7.1 | Quote (PDF + email send) | [`../0026-quote-pdf/plan.md`](../0026-quote-pdf/plan.md) |
| 7.2 | Contract (Dropbox Sign + signed-PDF archive) | _not yet scaffolded_ |
| 7.3 | Invoice (Stripe invoice from accepted quote) | _not yet scaffolded_ |
| 7.4 | Payment (webhook + campaign status flip) | _not yet scaffolded_ |

## Shared foundation (built in 7.1, reused by 7.2–7.4)

7.1 lays groundwork that 7.2–7.4 reuse instead of each chunk re-deciding:

- **PDF template pipeline** — branded source PDFs stored in Google Cloud Storage; runtime fill via `pdf-lib`; rendered output returned as Buffer or signed URL. 7.2 (MSA) and 7.3 (invoice PDF, if we render our own) reuse the same loader.
- **GCS storage adapter** — credentials + bucket + signed-URL helper. Reused for storing rendered quote PDFs, signed MSA PDFs (after Dropbox Sign webhook), and any other archived business docs.
- **Document-status state machine** — quotes carry `draft|sent|accepted|declined`; contracts and invoices follow analogous shapes.
- **Email-send foundation** — already in place from 5.5 (`src/lib/email/send.ts`); 7.x adds React Email templates per doc type.

## Sequencing

- 7.1 → 7.2 → 7.3 → 7.4 is the natural dependency order (quote precedes contract precedes invoice precedes payment), but 7.1 and 7.2 can run in parallel once 7.1's PDF + GCS foundation lands.
- Prereq: **5.2** (Campaign CRUD, Done) — quotes/contracts/invoices all attach to a `campaigns.id`.
- Prereq: **5.5** (Email send via Resend, Done) — foundation for the quote-email and contract-email paths.
- Prereq: **0019** (Audit log + `requireRole`, Done) — every send/accept/sign action emits an audit row.

## Conventions referenced

- `docs/wiki/architecture.md` — currently lists `@react-pdf/renderer` as the planned PDF lib in the "Future integrations" row. **7.1 reconsiders this** in favour of `pdf-lib` + GCS-stored template files (designer builds the branded PDF; runtime fills it). If the trade-off lands, update `architecture.md` when 7.1 ships.
- `docs/wiki/auth.md` — webhook routes are in `src/app/**/route.ts` (external callers); the *send* actions are Server Actions per the convention in `CLAUDE.md`.
- `docs/wiki/data-model.md` — quote/contract/invoice all attach to `campaigns.id`; new tables follow STAR-aligned naming.
- `docs/wiki/security.md` — public accept/decline links are tokenised route handlers, not Server Actions; rate-limit before they ship (carry-forward from 0019 follow-ups).

## Open questions

- **PDF library choice:** `pdf-lib` (load existing PDF, fill fields/overlay text) vs. `@react-pdf/renderer` (build PDFs in JSX). 7.1 picks for the loop; revisit only if the choice doesn't carry to 7.2/7.3 cleanly.
- **GCS vs. Supabase Storage** for blob storage. Cloud Run is already on GCP and existing infra leans GCS, but Supabase Storage already has wired auth + RLS. Decision lands in 7.1 Phase 1.
- **Per-doc branded templates:** one template per doc type (quote / MSA / invoice), or a shared base template + per-doc overlays? Decide in 7.1; 7.2/7.3 inherit.
- **Public accept-link auth:** tokenised public URL (default), or signed-in client portal (when contacts get auth)? v1 = tokens; portal version is a later iteration once contact-side auth lands.
- **Idempotency posture:** every external-integration leaf (Stripe, Dropbox Sign) has a webhook that can fire more than once. Each sub-plan owns its own idempotency story (event-id table, conditional UPDATE, or upsert) — this umbrella just calls it out.
