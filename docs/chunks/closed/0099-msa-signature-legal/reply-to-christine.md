# Draft reply to Christine (MSA legal review)

> Draft for Shannon to send back to Christine. Covers her five notes on the signed MSA.
> Context for us (not for the email): the platform e-signs via **BoldSign**, not DocuSign.
> BoldSign cryptographically tamper-seals the entire document on completion, which is why
> her "one signature is fine if the platform authenticates all pages" caveat holds.

---

Hi Christine,

Thank you — this was really helpful. We've made all of the changes to the agreement template. Here's where each of your notes landed:

1. **Client address moved.** The client's address no longer appears on page 1. It now sits directly below the Client's signature, in the "For the Client" block.

2. **Full name on the signature.** The system now uses the signer's full first and last name for the signature (previously it defaulted to the first name only), so the signature the client adopts is their full legal name.

3. **Added below the Client's signature.** The Client block now includes:
   - a **printed full name** field the signer completes,
   - a **title** field (their role with the company), and
   - the line: **"I confirm I have the authority to bind the Client to this Agreement."**

4. **Per-page initials.** We looked into this. We use an e-signature platform (BoldSign) that cryptographically seals and tamper-proofs the entire document once it's signed — any change to any page after signing invalidates the seal. So a single signature authenticates all four pages, and initials on the first three pages aren't necessary for enforceability. We're glad to add them if you'd still prefer the extra belt-and-suspenders, but wanted to flag that the platform already covers the concern you raised.

5. **Terms & conditions on the Quote.** Good news — this is no longer the QuickBooks problem it was. In the new system the **full terms and conditions live in this signed Master Services Agreement**, which the client signs once. Each **Quote** then incorporates those terms by reference (it states that it's governed by the Master Agreement) and carries a short terms & payment summary, so we don't have to cram the full T&Cs onto every quote. Every accepted quote is a contract *under* the signed MSA.

Happy to send you a fresh sample of the updated agreement to review, and to add page initials if you'd like them.

Thanks again,
Shannon

---

## Internal notes (do not send)

- Changes shipped in chunk `0099-msa-signature-legal` (`b762349`, `33890ec`).
- Template version bumped to `2026-07-07` — the prod deploy must set `_MSA_TEMPLATE_VERSION=2026-07-07` on the Cloud Build trigger so signed rows record the new wording.
- Sample rendered PDF for eyeballing: `scratchpad/msa-0099-sample.pdf` (session scratchpad).
- If Christine wants the initials after all: the BoldSign `Initial` field type is already wired (`initialsAnchors` on `sendSignatureRequest`) — it's a render-anchor + wiring change, not new infrastructure.
