# Quote + MSA as One Document — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _Not started — scaffolded 2026-05-21_

> **Phase 1 (verbatim MSA) comes first** — the current renderer is truncated/paraphrased (see `intent.md`), so it must be replaced with the lawyer's exact text before anything is merged. **Phase 5 is blocked** on the owner resending the quote "statement" (the legal boilerplate at `render-quote.ts:56-67`). Phases 1–4 (verbatim text + structural merge + field anchoring + send/webhook collapse) can proceed without it.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Replace MSA prose with the full verbatim lawyer agreement (§1–§10) | In Progress | uncommitted — code done, awaiting owner/lawyer eyeball + env bump |
| 2: Merge Quote + MSA into one PDF | Pending | - |
| 3: Initials field(s) + bottom-of-contract-page signature anchors | Pending | - |
| 4: Send path + webhook collapse to a single signed artifact | Pending | - |
| 5: Drop in the resent quote statement (BLOCKED on owner) | Pending | - |
| 6: Tests + smoke verification | Pending | - |

This chunk first restores the MSA to the lawyer's verbatim agreement, then collapses the current two-PDF BoldSign envelope (separate MSA + Quote, signature on the MSA only) into a single merged document the Client initials and signs once. "Done" looks like: the full 10-article agreement rendered verbatim, one envelope file, initials + a contract-page signature anchored to the right page, and one `Signed` webhook flipping both MSA→`active` and Quote→`accepted`.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Verbatim §1–§10 clause text (rewrite `buildSections`) | `src/lib/pdf/render-msa.ts:110-151` (`buildSections` — current truncated/paraphrased prose) | Same function; source = lawyer's `.docx` (path in intent + Phase 1 below) |
| Merged-PDF builder (concatenate Quote + MSA, return combined bytes + page offsets) | `src/lib/pdf/render-msa.ts:171` (`renderMsaPdf` returns bytes + `signatureAnchor`) | Same module/role — produces the signable artifact + anchor coords |
| Quote-section bytes for the merge | `src/lib/pdf/render-quote.ts:135` (`renderQuotePdf`) | The Quote half of the merged doc; reused as-is |
| Initials + signature `FormField`s from anchors | `src/lib/boldsign/client.ts:130-146` (signature `FormField` build) | Same field-building code; add Initials field type alongside the existing Signature field |
| Single-file envelope post | `src/features/msa/actions.ts:325-341` (`sendMsaEnvelope` two-file `files: [...]`) | Same action; collapse the two-file array to one merged file + re-point the anchor |
| Single signed-artifact handling | `src/app/api/boldsign/webhook/route.ts:68-109` (downloads signed PDF → GCS, flips MSA active) | Same handler; ensure the one-doc flip covers both MSA-active and Quote-accepted |
| Updated statement text | `src/lib/pdf/render-quote.ts:56-67` (`TERMS_AND_CONDITIONS` / `INVOICING_AND_PAYMENT`) | Phase 4 swaps this constant for the owner's resent text |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — MSA/Quote lifecycle and the bundled-envelope happy path; update when the artifact count changes.
- `docs/wiki/data-model.md` — MSA pending→active gate + GCS paths (`msa/{msaId}/signed.pdf`).
- `CLAUDE.md` → **Conventions** — mutations are Server Actions; the BoldSign webhook is a legit route handler (external caller).

**Overall Progress:** 0% (0/6 phases complete)

**Note:**
- The lawyer's Agreement prose must be **verbatim** — Phase 1 transcribes the `.docx` exactly; later phases must survive the merge byte-for-byte.
- The signature anchor's `pageNumber` is currently relative to the first envelope file (the MSA); after the merge it must be recomputed against the combined document's page layout.
- Bump `MSA_TEMPLATE_VERSION` when Phase 1 lands — the prose changes substantially, and `master_service_agreements.templateVersion` records which revision each signed PDF used.

### Phase Checklist

#### Phase 1: Verbatim MSA text
- [x] Rewrite `buildSections` (`render-msa.ts`) to the lawyer's full agreement, source: `/Users/davidwhogan/Downloads/MASTER SERVICES AGREEMENT - March 25, 2026 (1).docx`
- [x] All 10 articles, verbatim: §1 Services (incl. Master Agreement, Quote, Precedence, Cooperation, Sub-contractors), §2 Term & Termination (Term, Termination on Notice = **30 days**, Cancellation Fee 21d/50%, Termination for Non-Payment), §3 Fees & Payment, §4 Liability & Indemnity (incl. Vicimus Inc. carve-out, General Indemnity, Survival), §5 Intellectual Property, §6 Personal Information / PIPEDA / CASL, §7 Confidentiality, §8 Independent Contractor, §9 Governing Law (Nova Scotia), §10 General Provisions
- [x] Add the recitals/Parties block verbatim; **deleted the fabricated §2 renewal clause**
- [x] Wire only genuine placeholders: client legal name + §2 notice = 30. (Note: the verbatim §2(i) Term clause references "the date this Agreement is signed … twelve (12) months thereafter" — no explicit dates — so `termStart`/`termEnd`/`governingLaw` in `MsaPdfData` are now passed-but-unused; left in the type to avoid caller churn.) WinAnsi `sanitize()` retained; source transcribed with straight quotes/apostrophes so nothing renders as `?`.
- [x] Re-verify the signature-anchor capture still resolves (42 pdf+msa tests pass; anchor lands on the final page; smoke PDF written to `/tmp/msa-smoke.pdf`)
- [ ] **Bump `MSA_TEMPLATE_VERSION`** — env-driven (not code); set `MSA_TEMPLATE_VERSION=2026-05-21` in `.env.local` + the deployment env so new MSA rows record the verbatim revision
- [ ] **Owner/lawyer eyeball** the rendered PDF (`/tmp/msa-smoke.pdf`) against the `.docx` before merge work begins

#### Phase 2: Merge Quote + MSA into one PDF
- [ ] Decide order with the owner (Quote-first vs Agreement-first) — see intent Open Questions
- [ ] Build a merge step that concatenates `renderQuotePdf` + `renderMsaPdf` bytes (pdf-lib `copyPages`), returning combined bytes + the page offset where the Agreement begins
- [ ] Recompute the Agreement's `signatureAnchor.pageNumber` against the merged page layout
- [ ] Verify the lawyer's clause text renders identically pre/post-merge (no reflow)

#### Phase 3: Initials + signature anchors
- [ ] Capture initials anchor coord(s) at the chosen location(s) in the renderer (mirror the underline-capture pattern in `render-msa.ts`)
- [ ] Add an Initials `FormField` type in `client.ts` alongside the existing Signature field
- [ ] Place the signature `FormField` at the bottom of the contract page in merged-doc coords
- [ ] Unit test: anchors resolve to expected page numbers + bounds in the merged doc

#### Phase 4: Send path + webhook collapse
- [ ] `sendMsaEnvelope` posts a single merged file (drop the two-file `files: [...]` array)
- [ ] Re-point the BoldSign field anchors to the merged file
- [ ] Webhook flips MSA→`active` AND Quote→`accepted` from the one `Signed` event; persist the single signed PDF to GCS
- [ ] Confirm idempotency on re-send still holds

#### Phase 5: Resent quote statement (BLOCKED on owner)
- [ ] Replace `TERMS_AND_CONDITIONS` / `INVOICING_AND_PAYMENT` with the owner's resent text
- [ ] Confirm the Agreement (lawyer) text is unchanged — only the quote statement moved

#### Phase 6: Tests + smoke verification
- [ ] Unit tests: merged-PDF page count, anchor page numbers, field types
- [ ] Integration: send envelope (mocked BoldSign), simulate `Signed` webhook, assert MSA active + Quote accepted + GCS write
- [ ] Live BoldSign sandbox smoke (pairs with parked `0041 follow-up (e)`): one merged doc shows initials + signature in the BoldSign UI at the right spots
- [ ] Update `docs/wiki/commercial-spine.md` + `data-model.md` for the single-artifact envelope
