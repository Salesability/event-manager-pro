# `<Can>` ↔ `assertCan` pairing CI check (catch asymmetric gates)

**Started:** 2026-05-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Capability extraction script (Can/useCan vs assertCan/can) | Done | 47df3f6 |
| 2: Set diff → CI fail on asymmetric gates | Done | 47df3f6 |
| 3: Wire + document the convention + close | Done | 47df3f6 |

The capability layer (0029) gives every gated affordance a name. The convention is: every `<Can capability="X">` in the UI must pair with `assertCan('X')` (or surviving `requireRole`) in the action it triggers. Today this is a code-review responsibility. This chunk makes it a tooling check: a small script greps the codebase for capability strings on both sides, builds two sets, and fails CI if either side has a capability the other doesn't. Catches **(a)** "added a Cancel button without an action gate" — high-impact security leak — and **(b)** "added a server gate but UI still shows the button" — UX leak. **Done = the script runs in CI; passes against the current surface; deliberate breakage of either side fails the check; documented as part of the capability convention.**

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `scripts/check-capability-pairing.ts` (Node script — extract caps from both sides, diff, exit non-zero on mismatch) | `scripts/calendar-clamp-smoke.ts` | Same scripts/ dir, same `.ts`-via-tsx invocation shape. Difference: this one is run by CI, not interactively. Anchor on the existing tsx-script convention. |
| Optional: a vitest equivalent — `src/components/auth/__tests__/can-pairing.test.ts` running the same diff logic | `src/lib/auth/capabilities.test.ts` | If preferred to live as a test instead of a separate script. Decide in Phase 1 — script is simpler to invoke from CI; test piggybacks on existing `pnpm test` but mixes responsibilities. |

**Conventions referenced:**
- `docs/wiki/auth.md` § "Capability gating" — the rule that `<Can>` and `assertCan` use the same capability string. This chunk enforces that rule mechanically.
- `docs/wiki/auth.md` § "Capability matrix" — the canonical capability list. The diff check uses this as the "expected" set: any capability that appears in code but not in the matrix file is a third class of mistake (typo or undocumented capability) — the script can flag this too.

**Overall Progress:** 100% (3/3 phases complete)

**Note:**
- Forward-compatible with 0033 (next-safe-action). When `assertCan` migrates to middleware, the script's regex for the server side updates from `assertCan\('(...)'`)\` to also match `metadata\(\{capability: '(...)'`)\` or whatever shape the middleware adopts. The capability *strings* don't change.
- Pairs with 0031 (lint rule, gate presence) and 0032 (matrix test, admit set). Together they cover the three failure classes: gate-missing, gate-wrong, gate-asymmetric.
- Each phase ends with `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

## Open Questions

1. **Script vs test?**
   - *Working assumption:* script. CI invokes it explicitly (`pnpm check:capability-pairing`); failure mode is a clear "asymmetric gate" report rather than a generic test failure. Easier to extend later (e.g. when a new exception class needs documenting).
2. **What about `useCan('X')` standalone calls (no `<Can>`)?**
   - *Working assumption:* same regex catches them — they take the same string-literal arg. Treat them identically.
3. **Capabilities used inside conditionals (e.g. `if (useCan('X')) ...`) vs `<Can>` wrappers — are they treated the same?**
   - *Working assumption:* yes. Either pattern means "the UI is gating on capability X"; if the server doesn't gate on X, that's the asymmetry the check exists to flag.
4. **What about role-list gates that don't go through capability strings (`requireRole(['admin','coach'])`)?**
   - *Working assumption:* out of scope. The check is *capability* pairing, not role-list pairing. Role-list gates are by-design not capability-keyed (per Open Question 5 of 0029); the matrix test (0032) covers them by admit-set instead.
5. **False positive: capabilities that are *only* server-side or *only* client-side?**
   - There legitimately are some — e.g. `production:export` is only triggered server-side via the Route Handler; no UI affordance points at it. *Working assumption:* an `// expected: server-only` allow-list comment on the action's `assertCan` line opts it out of the pairing check. Same shape as 0031's `// authz: public` opt-out.

## Phase Checklist

### Phase 1: Capability extraction

- [x] Created `scripts/check-capability-pairing.mjs` (Node ESM, no deps — runs via `node scripts/...`). Two extraction passes over `src/**/*.{ts,tsx,jsx,mjs,cjs,js}` (skipping `*.test.*` + `capabilities.ts` source-of-truth + `node_modules`/`.next`/etc):
  - **UI side**: `<Can\s+capability="([^"]+)"` + `\buseCan\(\s*["']([^"']+)["']`.
  - **Server side**: `\bassertCan\(\s*["']([^"']+)["']` + `\bcan\([^,)]+,\s*["']([^"']+)["']`.
- [x] Two `Set<string>`-equivalent maps; per-capability classification with the opt-out states folded in.
- [x] Per-line opt-out: `// expected: server-only`, `// expected: ui-only`, or `// expected: both` recognised via tail-of-line regex.
- [x] Report shape: `Capability pairing scan: X/Y capabilities paired or opted out.` then `OK` or per-failure `'cap' (kind — present on the wrong side) at <file:line> ... <hint>`.

### Phase 2: Diff → CI fail

- [x] Added `check:capability-pairing` to package.json (`node scripts/check-capability-pairing.mjs`).
- [x] First run against current codebase reported FIVE asymmetries: `production:export` + `coach-availability:edit-own` (legitimately server-only) AND `person:create` + `person:adopt-orphan` + `dealer:create` (real UI-affordance gaps where the page-level `requireRole('admin')` was carrying the load instead of `<Can>`). Wrapped the three real-gap buttons with `<Can capability=...>` in `people-admin.tsx`, `dealers-admin.tsx`, `orphan-auth-users.tsx`.
- [x] Added `// expected: server-only` opt-out in `production/export/route.ts` (Route Handler, no UI button) + reworked the `availability-authz.ts` doc-comment so the regex stops matching its prose mention of `assertCan('coach-availability:edit-own')`.
- [x] Re-ran — green: `Capability pairing scan: 14/14 capabilities paired or opted out.`
- [x] Sabotage: renamed a `<Can capability="person:create">` to `person:bogus` — script flagged both `person:bogus (ui-only)` AND `person:create (server-only)`. Restored.

### Phase 3: Wire + document + close

- [x] No GH Actions workflow exists today; `pnpm check:capability-pairing` is the developer-terminal gate. Documented in the wiki ritual; future CI workflow should add it next to `pnpm lint` + `pnpm test`.
- [x] Updated `docs/wiki/auth.md` § "Structural enforcement of the matrix" with the third sublayer (gate symmetry) — references the script + opt-out convention.
- [x] Appended `wiki/log.md` entry.
- [x] Smoke: `pnpm check:capability-pairing` → 14/14 paired or opted out.
- [x] Smoke: `pnpm tsc --noEmit && pnpm lint && pnpm test --run` → tsc clean, lint clean (4 pre-existing warnings), 441/441 vitest.
