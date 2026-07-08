# Align MSA PDF logo with the title — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Align the logo to the title in the MSA header | Done | `efae4e5` |
| 2: Consistency + tests + visual verify | Done | _(next commit)_ |

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

**Overall Progress:** 100% (2/2 phases complete)

**Note:**
- No DB, no migration, no new secret — pure PDF-layout tweak.
- No `MSA_TEMPLATE_VERSION` bump (layout-only; the legal content is unchanged).
- Verification is a rendered-sample eyeball, not a browser smoke (the MSA renderer has no interactive UI surface).

### Phase Checklist

#### Phase 1: Align the logo to the title in the MSA header
- [x] Decide the alignment target on a sample (top-edge / optical-center / cap-band) — **settled: center the logo box on the title's cap-band optical center** (`titleMidY`). Root cause was the anchor choice, not the JPG (padding is ~symmetric 11% top/bottom, verified), so a pure `y`-re-anchor fixes it — no resize, no asset change.
- [x] Adjust the logo draw in `render-msa.ts` (re-anchor `y` to `titleMidY - logoH/2`) so its optical center meets the title cap band; title metrics moved above the logo draw so `titleMidY` is available
- [x] Keep the address block anchored to the **original** band bottom (`yRight = logoBandBottom - 14`, `logoBandBottom = y - logoH` = the pre-change value 678) — the raise decouples the logo's *drawn* position from the right-column layout anchor, so the address (and everything below) does not move. No overlap, 31pt clean gap.
- [x] Confirm `y = Math.min(yLeft, yRight) - 22` — the recitals/body start — is unchanged: **`pdftotext` diff of all 4 pages before-vs-after is byte-identical** → no reflow, no pagination change, signature anchor unaffected.
- [x] Render `scratchpad/msa-0101-sample.pdf` (harness: `scratchpad/render-msa-sample.ts` + `stub-cjs.cjs` to neutralize the `server-only` import) and eyeball: logo now optically centered on the title, address clean below, page-1 body unshifted (side-by-side in `scratchpad/masthead-compare.png`)

#### Phase 2: Consistency + tests + visual verify
- [x] Resolve the quote-consistency open question — **YES, mirrored** into `render-quote.ts` (identical top-anchor bug; the two headers are explicitly kept in lock-step and ship in the same bundled envelope). Same shape: title metrics moved above the logo draw, logo centered on `titleMidY`, right column re-anchored to `logoBandBottom` (unchanged value). Rendered `scratchpad/quote-0101-after.pdf` → balanced masthead confirmed (`scratchpad/quote-masthead-compare.png`).
- [x] Update `render-msa.test.ts` / `render-quote.test.ts` — **no edits needed**: neither asserts the header-logo geometry (they hook the signature/initials anchor + text-field boxes, all unchanged). Both files stay green (18 passed / 2 skipped).
- [x] `pdftotext` sanity check — **byte-identical before/after on ALL pages** for both the MSA (4 pages) and the quote (`diff` empty). Proves the move is purely visual: text content + order + pagination unchanged, signature anchor unaffected.
- [x] Visual smoke (manual): samples rendered for owner eyeball — `scratchpad/msa-0101-sample.pdf`, `scratchpad/quote-0101-after.pdf`, side-by-sides `scratchpad/masthead-compare.png` + `scratchpad/quote-masthead-compare.png`.
- [x] Wiki/log: added a one-line `docs/wiki/log.md` entry (2026-07-07, 0101) — the header layout is only documented at the high level ("logo top-right", not made stale), but the log entry keeps the customer-facing-PDF maintenance record complete alongside 0099/0100.

**Verification note:** this is a `Visual smoke (manual)` chunk — there's no web-test route to drive. The gate is the rendered sample PDF plus a `pdftotext` diff proving the text layer (content + order) is byte-identical to the pre-change MSA, so the move is provably visual-only.
