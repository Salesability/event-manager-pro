# MSA signature-block legal fixes — Intent

**Created:** 2026-07-07

## Problem

Christine (legal) reviewed a signed Master Services Agreement and flagged several things that weaken its enforceability. Today the MSA (rendered programmatically in `src/lib/pdf/render-msa.ts`, no template file) prints the Client's address on page 1 under the recitals, captures **only the signer's first name** (`resolveQuoteRecipient` returns `{ email, firstName }`), and gives the Client **one BoldSign signature field** with no printed full name, no title, and no attestation of authority to bind. Her notes:

1. The Client address (currently on page 1) should sit **directly below the Client's signature**.
2. The signer's **first + last name** must appear — a first name alone is not legally binding.
3. Below the Client signature, add: the **full name** of the person signing, their **title** with the company, and the sentence **"I confirm I have the authority to bind the Client to this Agreement."**
4. *(Optional)* per-page initials on the first 3 pages, in case the e-sign platform doesn't authenticate every page.
5. *(Question)* Did the new system manage to fit all terms & conditions on the Quote (the old QuickBooks pain)?

She wrote in DocuSign terms; we actually use **BoldSign**, which cryptographically tamper-seals the whole document — so her "one signature is fine if the platform authenticates all pages" caveat holds.

## Desired outcome

A future MSA envelope, sent from the dealer page (or the admin test tool), produces a signed PDF where the **"For the Client"** block carries: the BoldSign signature (defaulting to the signer's **full** name), a signer-filled **printed full-name** field, a signer-filled **title** field, the **client address** (moved off page 1), and the static **authority-to-bind** attestation. Page 1 no longer shows the address. The `MSA_TEMPLATE_VERSION` bumps so signed rows record which wording/layout they agreed to.

## Non-goals

- **Per-page initials on pages 1–3** (Christine's optional #4). Decided **out** — BoldSign tamper-seals the whole document, so one signature is legally sufficient; we'll say so in the reply. (The `Initial` field type is already wired if we ever reverse this.)
- **Quote terms & conditions changes** (#5). Decided **answer-only, no code** — the full T&Cs live in the signed MSA and the Quote incorporates them by reference (`render-quote.ts` `TERMS_AND_CONDITIONS`). The Quote is hard-capped to one page; expanding it is not in scope.
- Re-signing any already-executed MSA. This is a template/layout change for **future** sends.
- Changing the Salesability counter-signature (Shannon's pre-applied left-column block) or the single-signer model.

## Success criteria

- `renderMsaPdf` emits the client address **in the signature section**, not on page 1, and returns anchors for the two new signer-filled text fields.
- The BoldSign envelope carries a required **TextBox** field for printed name and one for title, positioned below the Client signature, plus the existing signature field.
- The signer's full name (first + last) flows to `signer.name` so BoldSign's adopted signature defaults to the full name.
- The static **"I confirm I have the authority to bind the Client to this Agreement."** line renders in the Client column.
- `MSA_TEMPLATE_VERSION` is bumped; a rendered sample PDF eyeballs correctly (address below signature, name/title/authority present, page 1 clean).
- A drafted reply to Christine covers the initials rationale (#4) and the Quote-T&Cs answer (#5).

## Open questions

- Keep the pre-printed `data.signerName` under the right underline as a reference, or replace it entirely with the signer-filled printed-name field? (Lean: replace the pre-printed name with the fillable field; keep the pre-printed email.) — resolve at build time.
- Does the taller Client column push the signature block past the bottom margin on a full last page? The `y < margin + 120` guard (`render-msa.ts:375`) likely needs raising once the extra fields land.

## Why now

Legal has the signed MSA in front of them and gave concrete, cheap-to-apply notes; closing them tightens enforceability before more dealers sign under the current term.
