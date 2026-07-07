# MSA signature-block legal fixes — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Full signer name + template version | Done | b762349 |
| 2: Client-column rebuild (address + name/title fields + authority line) | Done | 33890ec |
| 3: Test tool, wiki, reply to Christine | Done | (docs) |
| 4: Tests + visual smoke | Pending | - |

Close Christine's legal notes on the MSA signature block: move the Client address below the signature, capture the signer's full name, add signer-filled printed-name + title fields plus the authority-to-bind attestation, and bump the template version. Initials (#4) and Quote T&Cs (#5) are explicitly out (see intent Non-goals). "Done" = a rendered MSA whose Client block carries full name / printed-name field / title field / address / authority line, with page 1 clean, and a reply drafted for Christine.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Address moved into the sig section (`render-msa.ts`) | current address block `render-msa.ts:330-337` + sig block `render-msa.ts:432-454` | Same file, same `page.drawText` idiom; move the block, keep the grey/9pt styling |
| New `printedNameAnchor` / `titleAnchor` capture (`render-msa.ts`) | signature anchor capture `render-msa.ts:422-431,477-483` | Same anchor-capture pattern (pdf-lib bottom-left → BoldSign top-left translation) |
| Extend `RenderResult` with the new anchors (`render-msa.ts:56-58`) | `SignatureAnchor` / `RenderResult` types `render-msa.ts:47-58` | Same type shape (`FieldAnchor`), same optionality convention |
| TextBox fields in `sendSignatureRequest` (`boldsign/client.ts`) | initial+signature field build `boldsign/client.ts:191-199` | `buildFormField` is field-type generic; mirror the `initialFields`/`sigField` mapping for TextBox |
| Thread new anchors through `SendSignatureRequestInput` | existing `signatureAnchor` / `initialsAnchors` input fields (`boldsign/client.ts` input type) | Same input-plumbing shape the signature/initials anchors already use |
| Full name from contact (`quotes/recipient.ts`) | `resolveQuoteRecipient` `recipient.ts:32-35,87-93` | Add `lastName` to the same select + return shape |
| `signerName` = full name in `sendMsaEnvelope` | `actions.ts:204-216` | Same action; compose first+last, pass full name to `signer.name` + `data.signerName` |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — "The MSA envelope (standalone, 0082)" §72-81 is the authoritative description of the single Client signature field, the pre-applied Shannon counter-signature, and the 96/72 BoldSign coordinate scaling. Must be re-ingested in Phase 3.
- Template-version doctrine (`commercial-spine.md` §140-142): any prose/layout change bumps `MSA_TEMPLATE_VERSION` so signed rows record which wording they agreed to.

**Overall Progress:** 75% (3/4 phases complete)

**Note:**
- Layout is a PDF, not a web page — Phase 4's smoke is a rendered-sample **visual** check + unit assertions on emitted anchors, not a `web-test` route walk.
- The MSA `Initial` field type is deliberately unused (initials are out of scope) — leave it wired.

### Phase Checklist

#### Phase 1: Full signer name + template version
- [x] `resolveQuoteRecipient` (`src/features/quotes/recipient.ts`) selects `contacts.lastName` and returns it alongside `firstName` (required — `contacts.last_name` is `notNull`).
- [x] `sendMsaEnvelope` (`src/features/msa/actions.ts:204-216,245`) composes `signerFullName = [firstName, lastName].map(trim).filter(Boolean).join(' ')` and passes the **full** name as both `data.signerName` (PDF right column) and the BoldSign `signer.name` (so the adopted signature defaults to full name). Fallback to first-name-only if last name is blank.
- [x] **Template version bump = env/deploy action, NOT a code edit.** Local `.env.local` + `.env.production.local` bumped `2026-05-21` → `2026-07-07`. **Prod deploy TODO (owner): set `_MSA_TEMPLATE_VERSION=2026-07-07` on the `deploy-prod-on-main` Cloud Build trigger when this ships.** `MsaPdfData.templateVersion` is sourced from `process.env.MSA_TEMPLATE_VERSION` via `currentMsaTemplateVersion()` (`src/features/msa/template-version.ts`); there is no code constant. Bump the local `.env.local` + `.env.production.local` to `2026-07-07` (gitignored — won't appear in the diff), and record that the **prod deploy must set `_MSA_TEMPLATE_VERSION=2026-07-07`** on the `deploy-prod-on-main` Cloud Build trigger (else new signed rows keep stamping the old `2026-05-21`). Bump only lands the day the layout ships — do it at deploy time, not before.
- [ ] ~~`render-msa.ts`: relocate the address~~ → **moved to Phase 2** (the two signature columns share one `y` cursor, so relocating the address is part of the full client-column rebuild — doing it here would leave a 1-commit regression).
- [ ] Unit: existing `render-msa.test.ts` + `actions.test.ts` + `client.test.ts` stay green (none assert signer name or forbid the new optional anchors); the resolver's new field is covered by the Phase 4 test pass.

#### Phase 2: Signer-filled name/title fields + authority line
- [x] `render-msa.ts`: Client column now lays out (below the signature underline): a **"Client signature"** caption, a **"Name:"** label + captured `printedNameAnchor` rule, a **"Title:"** label + captured `titleAnchor` rule, the client **email**, the moved **address**, then the wrapped static line **"I confirm I have the authority to bind the Client to this Agreement."** OQ resolved: the fillable **Name** field **replaces** the pre-printed `data.signerName` (kept the pre-printed email). The two columns now track independent cursors (`leftY`/`rightY`) from a shared `underlineY`.
- [x] Extended `RenderResult` to return `printedNameAnchor` + `titleAnchor` (same `FieldAnchor` shape + bottom-left→top-left translation as the signature anchor; all three share the resolved `pageNumber`). Guard fails loud if any is uncaptured.
- [x] Raised the pagination guard `y < margin + 120` → `y < margin + 250` (the taller Client block; verified it never clips — smoke render bottoms out well above the margin).
- [x] `SendSignatureRequestInput`: added optional `printedNameAnchor` / `titleAnchor`.
- [x] `sendSignatureRequest`: builds required `FormField.FieldTypeEnum.TextBox` fields (`ClientPrintedName`, `ClientTitle`) via `buildFormField`, appended after the signature field (present only when the anchors are supplied).
- [x] `sendMsaEnvelope` **and** `sendTestMsa`: pass the render result's new anchors into `sendSignatureRequest`.
- [x] Smoke-verified via a throwaway render (`scratchpad/msa-0099-sample.pdf`): 3 anchors on one page, ordered top-to-bottom, name field right of the label; page 1 carries no address; the Client block reads signature → Name → Title → email → address → authority line. **Permanent unit assertions land in Phase 4.**

#### Phase 3: Test tool, wiki, reply to Christine
- [x] Verified the admin **Send Test MSA** path exercises the new fields for free — Phase 2 wired `printedNameAnchor`/`titleAnchor` into `sendTestMsa` too, and it shares `renderMsaPdf` + `sendSignatureRequest`. No new title input needed (title is signer-filled); the free-text `signerName` stays. No code change required.
- [x] Ingested into `docs/wiki/commercial-spine.md` (rewrote the "Signing field" bullet: signature + printed-name/title TextBox fields + authority line + relocated address + full-name sourcing + initials-declined) and added a `log.md` entry.
- [x] Wrote `reply-to-christine.md` — point-by-point (1–3 done; 4 = BoldSign tamper-seals all pages → one signature is legally sufficient, initials declined; 5 = full T&Cs live in the signed MSA, the Quote incorporates them by reference).

#### Phase 4: Tests + visual smoke
- [ ] Unit: rendered MSA asserts — no page-1 address; printed-name + title + authority text present in the sig section; full `signerName` printed; anchors returned.
- [ ] Unit: `sendSignatureRequest` builds signature + 2 TextBox fields (required, correct page, 96/72-scaled bounds).
- [ ] Visual smoke (manual): render a sample MSA to `scratchpad/msa-0099-sample.pdf` (reuse any existing render harness/test), eyeball the Client block order + page-1 cleanliness; save a screenshot path in the plan.
- [ ] `tsc` + unit suite green; `0 new lint` on chunk files.
