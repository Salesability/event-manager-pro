# Align MSA PDF logo with the title — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Align the logo to the title in the MSA header | Pending | - |
| 2: Consistency + tests + visual verify | Pending | - |

Nudge the MSA PDF header so the SaleDay Events logo reads as balanced against the "MASTER SERVICES AGREEMENT" title instead of hanging below it — a pure-layout change in `render-msa.ts`, verified by eyeballing a rendered sample. "Done" = the logo aligns with the title in `scratchpad/msa-0101-sample.pdf`, the address block below the logo is untouched, and page-1 body doesn't shift.

## Code Anchors

For a modification to an existing file, the anchor is the nearest sibling in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Logo alignment in the MSA header — `src/lib/pdf/render-msa.ts:291-298` | The title draw right below it, `src/lib/pdf/render-msa.ts:300-309` (`titleBaseline = y - titleAscent`) | The two things being aligned live 6 lines apart; match the title's baseline-math approach when re-anchoring the logo |
| (If applied) same fix in the quote header — `src/lib/pdf/render-quote.ts:191-197` | `src/lib/pdf/render-msa.ts:291-298` (the just-fixed MSA logo) | Identical logo-draw block; keep the two headers in lock-step |

**Conventions referenced:**
- `src/lib/pdf/render-msa.ts` is the single source of truth for MSA layout (pure `pdf-lib`, no HTML template) — coordinates are PDF points, origin bottom-left, images anchored by bottom-left corner (`y = top - height`).
- The header "mirrors `render-quote.ts`'s layout for visual consistency" (comment at `render-msa.ts:264`) — hence the Phase-2 consistency question.

**Overall Progress:** 0% (0/2 phases complete)

**Note:**
- No DB, no migration, no new secret — pure PDF-layout tweak.
- No `MSA_TEMPLATE_VERSION` bump (layout-only; the legal content is unchanged).
- Verification is a rendered-sample eyeball, not a browser smoke (the MSA renderer has no interactive UI surface).

### Phase Checklist

#### Phase 1: Align the logo to the title in the MSA header
- [ ] Decide the alignment target on a sample (top-edge / optical-center / cap-band) — settle the intent open question
- [ ] Adjust the logo draw in `render-msa.ts:291-298` (re-anchor `y` and/or account for the JPG's internal padding; a tuned offset may suffice) so it aligns with the title
- [ ] Keep the address block anchored to the logo's **actual** bottom (`yRight = y - logoH - 14` at `:327`) — no overlap with the title, no collision
- [ ] Confirm `y = Math.min(yLeft, yRight) - 22` (`:335`) — the recitals/body start — is unchanged (or verify page-1 still fits)
- [ ] Render `scratchpad/msa-0101-sample.pdf` (reuse the 0099 sample-render path) and eyeball: logo balanced with the title, address clean below, page-1 body unshifted

#### Phase 2: Consistency + tests + visual verify
- [ ] Resolve the quote-consistency open question; if yes, mirror the fix into `render-quote.ts:191-197` + render a quote sample to confirm
- [ ] Update `render-msa.test.ts` (and `render-quote.test.ts` if touched) only where it asserts the exact header geometry that changed; keep the structural assertions green
- [ ] `pdftotext scratchpad/msa-0101-sample.pdf -` sanity check: page 1 unchanged in text content (this is a visual-only move — text/order must be identical to 0099's output)
- [ ] Visual smoke (manual): attach `scratchpad/msa-0101-sample.pdf` for the owner to eyeball the masthead
- [ ] Wiki/log: a one-line `docs/wiki/log.md` entry if the header convention is documented anywhere; otherwise none (no state-of-system change beyond layout)

**Verification note:** this is a `Visual smoke (manual)` chunk — there's no web-test route to drive. The gate is the rendered sample PDF plus a `pdftotext` diff proving the text layer (content + order) is byte-identical to the pre-change MSA, so the move is provably visual-only.
