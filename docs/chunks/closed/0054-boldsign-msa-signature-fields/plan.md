# BoldSign MSA Signature Form Fields — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-05-15

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Renderer captures signature-anchor coordinates | Done | `3d4deeb` |
| 2: `sendSignatureRequest` builds `FormField`/`Rectangle` from the anchor | Done | `3d4deeb` |
| 3: `sendMsaEnvelope` threads the anchor renderer → BoldSign | Done | `3d4deeb` |
| 4: Tests + live BoldSign smoke against `app-ca.boldsign.com` | Done | unit tests 77 PASS (`3d4deeb`); live Cloud Run smoke confirmed by user 2026-05-15 — envelope sent successfully, Signature field positioned over the right-column "For the Client" underline |

**Overall Progress:** 100% (4/4 phases complete) — closed without `/eval` per user direction after live smoke confirmation.

This chunk closes the gap discovered while unblocking the 2026-05-15 BoldSign 401: the MSA Send path doesn't tell BoldSign *where* the Client signature goes on the rendered PDF, so the SDK call either errors on "no fields defined" or ships a document with a missing/auto-placed signature tag. The fix is to capture the existing `(rightColX, y)` underline anchor at render time, return it from `renderMsaPdf()`, translate it into BoldSign's coordinate system inside `sendSignatureRequest`, and thread the value through `sendMsaEnvelope`. "Done" looks like: an envelope sent end-to-end via the Create-MSA dialog lands at the signer's inbox with the Signature field visibly positioned over the prose's "For the Client" underline.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `signatureAnchor` field on `renderMsaPdf()` success result (`src/lib/pdf/render-msa.ts`) | `src/lib/pdf/render-msa.ts:308-313` (existing `page.drawLine` for the Client signature underline) | Same module, same draw site — anchor capture happens inches from where the underline is already drawn |
| Anchor-capture stash in `render-msa.ts` (page index + bounds) | `src/lib/pdf/render-msa.ts:282-284` (existing dynamic pagination block — `if (y < margin + 120) { page = doc.addPage(...); y = pageHeight - margin; }`) | Same module; the anchor stash sits in the same local-state scope as the pagination logic so the recorded page is whichever page the signature actually landed on |
| `signatureAnchor` on `SendSignatureRequestInput` type (`src/lib/boldsign/client.ts`) | `src/lib/boldsign/client.ts:42-50` (existing `SendSignatureRequestInput` type) | Same module, same type — additive optional field at first, required after Phase 3 wires the only caller |
| `FormField`/`Rectangle` construction in `sendSignatureRequest` (`src/lib/boldsign/client.ts`) | `src/lib/boldsign/client.ts:72-75` (existing signer build — `new DocumentSigner()` + `name`/`emailAddress` set) | Same function; signature-field construction sits two lines below the existing signer field-set |
| Anchor threading in `sendMsaEnvelope` (`src/features/msa/actions.ts`) | `src/features/msa/actions.ts:323-338` (existing `sendSignatureRequest` call site) | Same action, same try-block; the renderer call already happens earlier — just need to surface the captured anchor through to the SDK call |
| `FormField` + `Rectangle` construction shape (across all three new code surfaces) | BoldSign Node SDK quick-start snippet pasted in conversation 2026-05-15 (`formField.fieldType = FormField.FieldTypeEnum.Signature; formField.pageNumber = 1; formField.bounds = bounds`) | Canonical example from the user's `app-ca.boldsign.com` console — single source of truth for the SDK shape until the BoldSign docs page is captured to disk |

**Conventions referenced:**
- `docs/wiki/data-model.md` — no schema change in this chunk; mentioned only because future Phase-5 "multi-signer" growth would touch the audit-payload shape.
- BoldSign SDK quick-start (Canada region: `https://app-ca.boldsign.com/api-management/sdks/node-sdk`) — gated behind auth; the snippet pasted in 2026-05-15 conversation is the working reference.
- `CLAUDE.md` → **Conventions** — mutations are Server Actions, not route handlers. No change here; `sendMsaEnvelope` is already a Server Action.

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- No DB migration. No new env var. No new dependency. Surface is three files: the renderer, the BoldSign client, the MSA action.
- Smoke verification needs a live `app-ca.boldsign.com` sandbox account with a valid `BOLDSIGN_API_KEY` + `BOLDSIGN_API_BASE_URL=https://api-ca.boldsign.com` (set during the 2026-05-15 region fix). No throwaway DB fixture script — the smoke is "click Create MSA in the UI → open the envelope in BoldSign console → eyeball the signature box position".

### Phase 1: Renderer captures signature anchor

- [ ] In `src/lib/pdf/render-msa.ts`, declare a local `let signatureAnchor: { pageNumber: number; x: number; y: number; width: number; height: number } | null = null;` near the top of the render function
- [ ] At the line just before `page.drawLine(...)` for the right-column signature underline (`:308-313`), stash:
  - `pageNumber` = current page index + 1 (BoldSign is 1-indexed; pdf-lib's `doc.getPages().indexOf(page)` + 1)
  - `x` = `rightColX`
  - `y` = the underline's y, possibly transformed (see Open Question on origin)
  - `width` = `colWidth`
  - `height` = pick a sensible value (Open Question; lean 22pt)
- [ ] Update `renderMsaPdf()`'s success return shape from `{ ok: true; body: Buffer }` to `{ ok: true; body: Buffer; signatureAnchor: NonNullable<typeof signatureAnchor> }` — fail-loud if the anchor never got captured (e.g. an empty MSA prose body that skipped the signature section — shouldn't happen, but assert it)
- [ ] Unit test: render a fixture MSA → assert `signatureAnchor.pageNumber >= 1`, `width > 0`, `height > 0`, `x >= margin`, anchor present
- [ ] Unit test: an MSA prose long enough to push the signature block onto page 2 → `signatureAnchor.pageNumber === 2`

### Phase 2: `sendSignatureRequest` builds the `FormField`

- [ ] In `src/lib/boldsign/client.ts`, extend `SendSignatureRequestInput` with `signatureAnchor: { pageNumber: number; x: number; y: number; width: number; height: number }` (required)
- [ ] Import `FormField` and `Rectangle` alongside the existing `DocumentApi`, `DocumentSigner`, `SendForSign` imports
- [ ] After the existing signer construction at `:72-75`, build:
  ```ts
  const bounds = new Rectangle();
  bounds.x = input.signatureAnchor.x;
  bounds.y = input.signatureAnchor.y;
  bounds.width = input.signatureAnchor.width;
  bounds.height = input.signatureAnchor.height;
  const sigField = new FormField();
  sigField.id = 'ClientSignature';
  sigField.fieldType = FormField.FieldTypeEnum.Signature;
  sigField.pageNumber = input.signatureAnchor.pageNumber;
  sigField.bounds = bounds;
  signer.formFields = [sigField];
  ```
- [ ] Add `signer.signerType = DocumentSigner.SignerTypeEnum.Signer;` per the SDK quick-start snippet — defensive, matches the documented example
- [ ] Unit test: input with a valid anchor → `signer.formFields` has one entry with `fieldType === Signature` and `pageNumber` matching the anchor
- [ ] Unit test: assert `bounds.x/y/width/height` propagate from the input
- [ ] Decision: making `signatureAnchor` required (not optional) means every caller must thread it; that's correct — there's exactly one caller (`sendMsaEnvelope`) and we want fail-loud on omission

### Phase 3: `sendMsaEnvelope` threads renderer → BoldSign

- [ ] In `src/features/msa/actions.ts`, find the `renderMsaPdf` call that produces the envelope body
- [ ] Capture the renderer's new `signatureAnchor` field alongside `body`
- [ ] At the existing `sendSignatureRequest` call site (`:323-338`), add `signatureAnchor: rendered.signatureAnchor` to the input object
- [ ] Verify the action's outer try/catch still surfaces a clear error if BoldSign rejects the field (e.g. coords out of page bounds — would surface as a 400 from BoldSign rather than 401)
- [ ] Existing integration tests for `sendMsaEnvelope` (`src/features/msa/actions.test.ts`) — extend any test that mocks `renderMsaPdf` to also provide `signatureAnchor`; extend the `@/lib/boldsign/client` mock to assert the input shape includes it

### Phase 4: Tests + live BoldSign smoke

- [ ] Run `pnpm vitest run src/lib/pdf/render-msa.test.ts src/lib/boldsign/client.test.ts src/features/msa/actions.test.ts` — all pass
- [ ] Run `pnpm tsc --noEmit` — clean
- [ ] Live smoke: from `/dealerships/1`, click **Create MSA** → fill the dialog → submit; in the BoldSign console at `app-ca.boldsign.com`, open the resulting document and confirm the Signature field is positioned over the "For the Client" prose underline on the MSA's last page
- [ ] Negative smoke: temporarily mutate the renderer to skip the signature section → `sendMsaEnvelope` fails loud with a clear "missing signature anchor" error rather than silently shipping a fieldless document → revert the mutation
- [ ] If the signature box is off-position (BoldSign uses top-left origin while we passed bottom-left, or width/height clipped the visible signature), narrow the coordinate translation in `render-msa.ts` and re-smoke
- [ ] Update `docs/wiki/log.md` with a one-line entry: signature-field anchor now flows render → BoldSign; cross-link to `0051-dropbox-sign-to-boldsign` as the parent migration that missed this gap
