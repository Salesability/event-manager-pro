# BoldSign MSA Signature Form Fields — Intent

**Created:** 2026-05-15

## Problem

`src/lib/boldsign/client.ts:72-75` constructs the `DocumentSigner` without setting `formFields`. The BoldSign Node SDK example (per the `app-ca` console quick-start) pins an explicit `Signature` `FormField` with `(pageNumber, bounds)` on each signer:

```ts
formField.fieldType = FormField.FieldTypeEnum.Signature;
formField.pageNumber = 1;
formField.bounds = bounds;     // x, y, width, height
documentSigner.formFields = [formField];
```

We don't. The MSA PDF is rendered in-repo (`src/lib/pdf/render-msa.ts`), so there are no embedded AcroForm fields BoldSign can auto-detect. Depending on the BoldSign account's "no fields defined" policy, sends from our app will either: (a) be rejected with an error after we clear the region/auth gates, (b) succeed but ship a document with no defined signature box, leaving the signer to drop one themselves, or (c) auto-place a tag in an aesthetically wrong spot. Surfaced during 2026-05-15 unblock of the BoldSign 401 (`docs/chunks/CURRENT.md` History entry for the same date documents the regional-host fix that preceded this gap).

The relevant prose-rendered signature line already exists at known coordinates: `render-msa.ts:308-313` draws the Client's signature underline at `(rightColX, y)` with width `colWidth` on whichever page the prose ended up on (the renderer paginates to a fresh page if there's less than ~120pt of headroom — see `render-msa.ts:282-284`). The work is to *capture* those coordinates as a structured "signature anchor" the renderer returns alongside the PDF bytes, then translate them into BoldSign's coordinate system in `sendSignatureRequest`.

## Desired outcome

`renderMsaPdf()` returns the PDF bytes *and* a `signatureAnchor: { pageNumber, x, y, width, height }` describing where the Client-side signature box belongs on the final document. `sendSignatureRequest` accepts an optional `signatureAnchor` on its input, and when present, builds a `FormField` + `Rectangle` matching the BoldSign SDK example and attaches it to the signer. `sendMsaEnvelope` threads the anchor from the renderer through to the BoldSign call. The signer receives a hosted-page sign link from BoldSign with the signature box pre-placed exactly where the prose's "For the Client" underline is — no manual drop-and-position step on the signer's side.

## Non-goals

- **No counter-signature box.** The MSA prose has a "For Salesability" column too (`render-msa.ts:299, 315-324`), but Shannon's signature today is the *printed* name + email — not a BoldSign signer slot. v1 keeps the Salesability side as printed prose; if/when a counter-signature is needed, that's a follow-up.
- **No initials / date / text fields.** Only the single primary `Signature` field. Date is implicit (BoldSign stamps signed-at metadata).
- **No quote-PDF signature work.** Quotes are accepted via the `acceptQuote` action with a tokened click-through; no signed-PDF flow exists today.
- **No layout changes to the rendered MSA.** This chunk captures existing coordinates; it does not move, restyle, or re-paginate the Signatures section.
- **No fallback to "let signer place their own field"** — if `signatureAnchor` is absent from the input (e.g. a future caller forgets to pass it), the send should fail loud rather than ship a fieldless document.

## Success criteria

- `renderMsaPdf()`'s success return shape gains `signatureAnchor: { pageNumber, x, y, width, height }` (or a similarly named field) carrying BoldSign-coordinate-system values for the Client signature box.
- `sendSignatureRequest`'s input type gains a `signatureAnchor` field; absent → send refuses with a clear error; present → builds a `FormField`/`Rectangle` and assigns it to the single `DocumentSigner.formFields`.
- `sendMsaEnvelope` calls the renderer, captures the anchor, and passes it through to `sendSignatureRequest`.
- A BoldSign envelope sent end-to-end through `sendMsaEnvelope` lands at the signer's inbox with the signature box visibly placed over the existing "For the Client" underline on the MSA's last page (manual smoke verification in the BoldSign console).
- Existing tests (`src/lib/boldsign/client.test.ts`, `src/features/msa/actions.test.ts`) updated to assert the FormField is built when an anchor is provided and that the missing-anchor branch refuses to send.

## Open questions

- **Coordinate-system translation.** `pdf-lib` (the MSA renderer) uses bottom-left origin in points; BoldSign's `Rectangle` and `FormField.pageNumber` semantics need confirmation. The BoldSign SDK example uses `pageNumber = 1` (1-indexed) and `bounds.x/y/width/height` with no documented origin in the snippet we have. Phase 1 resolves this empirically by sending a test envelope and eyeballing the box placement; if BoldSign's origin is top-left, the renderer flips the y at capture time.
- **Box dimensions.** Today's underline is 0.5pt-thick at a single y; the signature field needs a 2D area. Lean: width = `colWidth` (matches the underline), height = ~20-24pt (a reasonable signature row), positioned so the underline falls at the bottom of the box. Phase 1 picks the height; if the signer's drawn signature ends up clipped or floating, Phase 4 tweaks.
- **Final page tracking.** `render-msa.ts` paginates dynamically — we need to record *which* page the signature block landed on. The renderer has the page object in-scope at the time of draw (`page.drawLine(...)`) so capturing the index is mechanical; the question is whether to derive it from `doc.getPageCount() - 1` post-save or pass it explicitly through the renderer's local state.
- **Multi-signer future.** If the MSA grows a counter-signature slot (Shannon also signs in BoldSign), the anchor becomes a list, not a single field. Lean: ship v1 as a single optional anchor; refactor to a map keyed by signer role when the second signer arrives.

## Why now

The 2026-05-15 region-host fix (`src/lib/boldsign/client.ts:13-23` — see the CURRENT.md History entry for the same date) unblocked the BoldSign 401, so the user's MSA Create + Send flow is moments away from hitting "what, no signature fields?" as the next BoldSign error class. The just-closed `closed/0051-dropbox-sign-to-boldsign/eval-2026-05-15-1644.md` already flagged this gap as a Codex Medium parked under the renamed 0041 follow-up (e) "live BoldSign sandbox smoke" — the eval narrative explicitly notes that follow-up "now also covers signable-field-placement verification". This chunk is the structured form of that parked Medium. Scaffolding now turns "discover the gap mid-test" into "pull the next chunk forward." Independent of the active `0053-quote-line-items-table` work, so it parks rather than promotes; un-park is concrete and imminent (next BoldSign send hits the missing-fields error).
