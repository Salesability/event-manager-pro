# Quote + MSA as One Document — Intent

**Created:** 2026-05-21

## Problem

Today a Client receives **two separate PDFs bundled into one BoldSign envelope**: the rendered MSA (`src/lib/pdf/render-msa.ts`) and the first draft Quote (`src/lib/pdf/render-quote.ts`), posted together by `sendMsaEnvelope` (`src/features/msa/actions.ts`). The signature field anchors to the **MSA only** (`signatureAnchor: msaPdf.signatureAnchor`); the Quote rides along as a read-only reference attachment. The business owner wants the agreed-to quote and the lawyer's Agreement to read as **one whole document** the Client initials and signs at the bottom of the contract page — "one and done."

**Discovered 2026-05-21 — the rendered MSA is truncated and paraphrased.** Diffing `render-msa.ts` `buildSections()` against the lawyer's source (`/Users/davidwhogan/Downloads/MASTER SERVICES AGREEMENT - March 25, 2026 (1).docx`) shows the renderer emits only ~5 of the agreement's **10 articles**, all paraphrased rather than verbatim, with wrong clause numbering and a **fabricated "renewal" clause (§2.iii) that does not exist in the signed text**. Entirely missing: the full recitals/Parties block; §1 sub-clauses (Precedence, Cooperation, Sub-contractors); §2 Cancellation Fee + Termination for Non-Payment; **§4 Liability & Indemnity** (incl. the Vicimus Inc. third-party carve-out); **§5 Intellectual Property**; **§6 Personal Information / PIPEDA / CASL**; **§7 Confidentiality**; **§8 Independent Contractor**; **§10 General Provisions**. This directly violates the "Agreement stays verbatim" constraint below and must be fixed **before** the merge — folded in as Phase 1 of this chunk.

## Desired outcome

A Client receives a single signable document that combines the Quote and the MSA/Agreement. They **initial** where required and place **one signature at the bottom of the contract page**; on completion both the Quote (accepted) and the MSA (active) take effect from that single signing event. The lawyer's Agreement text is preserved verbatim — the merge changes packaging and field placement, not the legal prose.

## Non-goals

- **No edits to the lawyer's Agreement legal text.** The owner stated "the original Agreement from lawyer needs to be the same" — clause text in `render-msa.ts` stays verbatim.
- **No multi-signer / Salesability counter-signature flow.** Single Client signer, as today.
- **No embedded/in-app signing.** Continue to send via BoldSign email envelope.
- **No re-architecture of the quote-acceptance lifecycle** beyond collapsing the two-artifact envelope into one signed artifact.

## Success criteria

- The rendered MSA is the lawyer's agreement **verbatim** — all 10 articles, correct §1–§10 numbering, the fabricated renewal clause removed, with only genuine placeholders wired (client legal name, the §2 notice-day blank = **30 days**, term start/end dates).
- The envelope posted to BoldSign carries **one merged PDF** (Quote section + Agreement section), not two files.
- The document has **initials field(s)** plus a **signature at the bottom of the contract page**, anchored to the correct page in the merged PDF.
- A single BoldSign `Signed` webhook flips the MSA to `active` and the bundled Quote to `accepted`, persisting the one signed PDF to GCS.
- The MSA clause text is byte-for-byte the lawyer's text (no wording drift introduced by the merge).
- The quote's "statement" boilerplate matches the updated text the owner is resending.

## Open questions

- **The resent statement (BLOCKER).** The owner is resending the quote "statement." It currently lives at `src/lib/pdf/render-quote.ts:56-67` (`TERMS_AND_CONDITIONS` / `INVOICING_AND_PAYMENT`). Is the resend *replacing* that boilerplate, or *adding* the contract-page layout? Phase 4 is blocked until the text arrives.
- **Where do initials go?** Bottom of each page, only the Quote page(s), or specific clauses? BoldSign supports multiple Initials fields — need the owner's intent.
- **Document order.** Quote first then Agreement, or Agreement first then Quote with the quote as a schedule/exhibit? Affects which page is "the contract page" the signature sits on.
- **Merge mechanism.** Single combined renderer vs. `pdf-lib` page-concatenation of the two existing renderers (preserves verbatim Agreement most safely). Leaning concatenation.

## Why now

The owner explicitly asked for the one-document experience and is resending the quote statement to make it happen. This is the natural next step on the BoldSign spine after `closed/0041` (bundled envelope) and `closed/0054` (signature-field anchors), and it resolves the parked `0044 follow-up (a)` validity-deadline mismatch by collapsing the two artifacts into one.
