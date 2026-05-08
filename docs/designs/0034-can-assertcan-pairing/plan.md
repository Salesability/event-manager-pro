# `<Can>` ↔ `assertCan` pairing CI check (catch asymmetric gates)

**Started:** 2026-05-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Capability extraction script (Can/useCan vs assertCan/can) | Pending | - |
| 2: Set diff → CI fail on asymmetric gates | Pending | - |
| 3: Wire + document the convention + close | Pending | - |

The capability layer (0029) gives every gated affordance a name. The convention is: every `<Can capability="X">` in the UI must pair with `assertCan('X')` (or surviving `requireRole`) in the action it triggers. Today this is a code-review responsibility. This chunk makes it a tooling check: a small script greps the codebase for capability strings on both sides, builds two sets, and fails CI if either side has a capability the other doesn't. Catches **(a)** "added a Cancel button without an action gate" — high-impact security leak — and **(b)** "added a server gate but UI still shows the button" — UX leak. **Done = the script runs in CI; passes against the current surface; deliberate breakage of either side fails the check; documented as part of the capability convention.**

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `scripts/check-capability-pairing.ts` (Node script — extract caps from both sides, diff, exit non-zero on mismatch) | `scripts/calendar-clamp-smoke.ts` | Same scripts/ dir, same `.ts`-via-tsx invocation shape. Difference: this one is run by CI, not interactively. Anchor on the existing tsx-script convention. |
| Optional: a vitest equivalent — `src/components/auth/__tests__/can-pairing.test.ts` running the same diff logic | `src/lib/auth/capabilities.test.ts` | If preferred to live as a test instead of a separate script. Decide in Phase 1 — script is simpler to invoke from CI; test piggybacks on existing `pnpm test` but mixes responsibilities. |

**Conventions referenced:**
- `docs/wiki/auth.md` § "Capability gating" — the rule that `<Can>` and `assertCan` use the same capability string. This chunk enforces that rule mechanically.
- `docs/wiki/auth.md` § "Capability matrix" — the canonical capability list. The diff check uses this as the "expected" set: any capability that appears in code but not in the matrix file is a third class of mistake (typo or undocumented capability) — the script can flag this too.

**Overall Progress:** 0% (0/3 phases complete)

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

- [ ] Create `scripts/check-capability-pairing.ts`. Two extraction passes:
  - **UI side**: glob `src/**/*.{ts,tsx}` excluding `*.test.*`; regex for `<Can\s+capability="([^"]+)"` and `useCan\(\s*['"]([^'"]+)['"]`.
  - **Server side**: same glob; regex for `assertCan\(\s*['"]([^'"]+)['"]` and `can\([^,]+,\s*['"]([^'"]+)['"]`.
- [ ] Build two `Set<string>`. Compute symmetric diff.
- [ ] Apply opt-out parsing: any line ending in `// expected: server-only` (or similar marker) drops the capability from the *required-on-UI-side* set. Same for `// expected: ui-only` if such cases ever exist.
- [ ] Print a clean report on diff: list each capability that's only-on-one-side with file:line, plus the opt-out path.

### Phase 2: Diff → CI fail

- [ ] Add `pnpm check:capability-pairing` to package.json scripts (invokes the tsx script).
- [ ] Run against current codebase. Expected outcome: zero diff (every capability appears on both sides today, modulo `production:export` which is server-only and would need the opt-out).
- [ ] Add `production:export` opt-out comment in `production/export/route.ts`. Re-run — expect green.
- [ ] Sabotage: temporarily wrap a button in `<Can capability="dealer:bogus">`; run check; verify it reports the asymmetry; remove.
- [ ] Sabotage: temporarily delete the `<Can>` from one of the dealer row buttons; run check; verify; restore.

### Phase 3: Wire + document + close

- [ ] Add `pnpm check:capability-pairing` to the existing CI step (after `pnpm lint`, before `pnpm test`). If no CI is wired today, ensure it's at least documented as a pre-commit step (matches the project's current `pnpm tsc && pnpm lint && pnpm test` ritual).
- [ ] Update `docs/wiki/auth.md` § "Capability gating: actions + UI affordances" to reference the pairing check + the opt-out convention.
- [ ] Append `wiki/log.md` entry.
- [ ] Smoke: `pnpm check:capability-pairing` → green.
- [ ] Smoke: `pnpm lint && pnpm test --run` → green; the new check doesn't disrupt existing passes.
