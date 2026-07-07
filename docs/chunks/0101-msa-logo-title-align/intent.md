# Align MSA PDF logo with the title — Intent

**Created:** 2026-07-07

## Problem

On the rendered MSA PDF (`renderMsaPdf`, `src/lib/pdf/render-msa.ts`), the SaleDay Events logo (top-right) doesn't visually align with the **"MASTER SERVICES AGREEMENT"** title (top-left). Both are nominally anchored to the same top `y` — the logo is drawn top-edge at `y` with a fixed `logoH = 50` ([`render-msa.ts:293`](../../../src/lib/pdf/render-msa.ts)), and the 22pt title's cap-top is also computed to sit at `y` ([`render-msa.ts:300`](../../../src/lib/pdf/render-msa.ts)) — but the logo JPG's internal top/bottom padding plus its 50pt height make it read as sitting lower and unbalanced next to the much shorter title. Shannon flagged it on a real signed MSA (screenshot 2026-07-07). The same header layout is duplicated in the quote PDF (`render-quote.ts:183`).

## Desired outcome

The logo and the title read as one balanced masthead — the logo optically aligned with the title rather than hanging below it. The exact alignment target (top-edge vs optical-center vs cap-baseline) is settled during the build with a sample render in front of us. The fix must **not** disturb the "Salesability Canada Inc." address block below the logo, nor shift the recitals / body start on page 1 (0099 just moved the Client address off page 1 and page-1 vertical budget matters).

## Non-goals

- Not changing the logo asset (`public/saledayevents-logo.jpg`) itself.
- Not restructuring or re-theming the header — this is an alignment tweak, not a redesign.
- Not changing any MSA legal text, signature block, or `MSA_TEMPLATE_VERSION` (pure layout — no template-version bump).
- Applying the same fix to the quote PDF header is an **open question**, not a commitment (see below).

## Success criteria

- A rendered sample (`scratchpad/msa-0101-sample.pdf`) shows the logo visually aligned with the "MASTER SERVICES AGREEMENT" title as a balanced masthead.
- The "Salesability Canada Inc." address block still sits cleanly below the logo (no overlap, no collision with the title).
- Page-1 body (recitals onward) is unchanged / still fits — no cascade regression from the header edit.
- `render-msa.test.ts` stays green (adjust only if it asserts the exact header geometry we change).

## Open questions

- **Alignment target:** top-edge align, optical-center align, or align the logo's vertical center to the title's cap band? Resolve by eyeballing a sample render.
- **Root cause / mechanism:** is the gap from the JPG's internal padding (→ trim/measure content bounds or nudge `y`), or purely a chosen-anchor problem (→ recompute the logo `y`)? A simple tuned `y`-offset may be enough.
- **Quote consistency:** apply the identical fix to `render-quote.ts:183-197` so the two PDFs stay visually consistent? Leaning yes (cheap, same code shape), but the user only flagged the MSA.

## Why now

Christine's legal review + a real test MSA (0099) put a rendered MSA in front of the owner, who noticed the header logo/title misalignment. Small polish, but it's on the customer-facing legal document. Scaffolded ahead of the 0100 build so it's queued but not started.
