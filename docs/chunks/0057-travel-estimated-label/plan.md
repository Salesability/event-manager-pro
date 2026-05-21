# Travel Labeled "Estimated" — Plan

**Started:** _Not started — scaffolded 2026-05-21_

> Trivial one-phase chunk (label copy change) — `intent.md` skipped per `CLAUDE.md` convention. The owner asked that the Travel figure under a quote read as "estimated" so Clients don't treat it as a fixed charge.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Rename Travel label to "Estimated" in composer + PDF | Pending | - |

Rename the "Travel ($)" input label in the quote composer and the matching Travel line in the rendered quote PDF to read "Estimated Travel," then update any test fixtures that assert the old label.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Composer label `"Travel ($)"` → `"Estimated Travel ($)"` | `src/features/quotes/quote-composer.tsx:621` | The input label the owner sees while building a quote |
| PDF Travel line label | `src/lib/pdf/render-quote.ts` (Travel summary line) | The Client-facing rendered label — must match the "estimated" wording |
| Test fixture label | `src/lib/quotes/pricing.test.ts:98` (`'Travel (Hotel / Mileage / Air)'`) | Update if the label is asserted in tests |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — quote composer / PDF surface (no behavior change, copy only).

**Overall Progress:** 0% (0/1 phases complete)

### Phase Checklist

#### Phase 1: Rename Travel label
- [ ] `quote-composer.tsx:621`: `"Travel ($)"` → `"Estimated Travel ($)"`
- [ ] `render-quote.ts`: Travel line label gains "Estimated" (confirm wording with owner — "Estimated Travel" vs "Travel (estimated)")
- [ ] Update any test fixtures / assertions referencing the old Travel label
- [ ] Smoke (web-test): `goto /quotes/<draft-id>` composer; the Travel field label reads "Estimated Travel"
