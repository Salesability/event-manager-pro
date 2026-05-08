# Adopt `next-safe-action` as the standard Server Action wrapper

**Started:** 2026-05-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Install + bootstrap `action-client.ts` (base + auth + admin tier middlewares) | Done | - |
| 2: Pilot migration — dealer CRUD (`createDealer`, `updateDealer`, `archiveDealer`) + form caller + tests | Done | - |
| 3: Bulk migration — people / lookup / campaign / email (~17 remaining actions) | Done | - |
| 4: Retire hand-rolled validators (`parseId`, `field`, `parseLookupLabel`, …) — Zod schemas everywhere | Deferred (carry-forward) | - |
| 5: Wiki update + smoke + close | Done | - |

This chunk migrates every gated Server Action in the staff app from the hand-rolled `await assertCan(...)` shape to a `next-safe-action` middleware-chained client. The motivation isn't *"the current pattern is wrong"* — `assertCan` works correctly and is greppable. The motivation is **error-class reduction**: middleware composition makes the auth-required path the *default*, so writing an unauthed action requires explicit opt-out (the inverse of today's "remember to add the gate"). It also pulls input-validation into the same chain via Standard Schema (Zod), retiring the hand-rolled `field()` / `parseId()` / `parseLookupLabel()` helpers and giving every action a uniform `{data, validationErrors, serverError}` result shape that pairs natively with React 19's `useActionState`. Capability layer (0029) is **forward-compatible** — `capabilities.ts` is the PDP and stays untouched; `assertCan` becomes a `.use()` middleware so existing capability strings survive verbatim. Soft-trigger was meant to be `0016-book-your-event-intake` (untrusted public input wanting Zod), but the user is committing to this chunk independently as a risk-reduction investment ahead of that work — so when 0016 lands, it inherits the convention rather than seeding it.

**Done = every `'use server'` function in `src/features/*/actions.ts` and `src/app/(app)/**/route.ts` runs through a tiered safe-action client; hand-rolled FormData parsers retired; action result shape uniform across the app; `useActionState` consumers updated to read `validationErrors`/`serverError`/`data`; `auth.md` documents the middleware chain as the canonical PEP shape.**

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/actions/action-client.ts` (base safe-action client + tiered middlewares: `authedClient`, `adminClient`, `capabilityClient(cap)`) | `src/lib/auth/assert-can.ts` | Same dir-neighborhood (`src/lib/auth/` and `src/lib/actions/` are siblings under `lib/`), same `'server-only'` discipline, same redirect-on-fail control flow. The middlewares wrap the existing helpers — `getUser()` + `loadCurrentMembership()` + `can()` — so the load-bearing logic stays in `auth/`; this file is just the composition layer. |
| Pilot — `src/features/schedule/actions.ts` `createDealer` / `updateDealer` / `archiveDealer` migration | `src/features/schedule/actions.ts:56-280` (current dealer action shape) | Same file, same actions; the rewrite is mechanical — replace `'use server'` + hand-rolled FormData parse + `assertCan` line with `adminClient.schema(z…).action(async ({parsedInput, ctx}) => { ... })`. Anchor is the *before* shape so the diff is reviewable in one glance. |
| Zod schemas for dealer inputs — colocated in `src/features/schedule/actions.ts` (or extracted to `src/features/schedule/schemas.ts` if size grows) | `src/features/schedule/validators.ts` (the file being retired) | Zod schemas replace the hand-rolled `parseDealerInput` / `parseId` / `field` shape. Anchor on the validators file shows what semantics each new schema must preserve (required fields, length caps, email regex, ID coercion). |
| Caller-side update — `src/features/dealers/dealer-form.tsx` (`useActionState` consumer reading new result shape) | `src/features/dealers/dealer-form.tsx:60-80` (current `useActionState` block) | Same file; result shape changes from `{ok:true} \| {error:string}` to `{data?, validationErrors?, serverError?}`. Anchor shows what to swap. |
| Test rewrite — `src/features/people/actions.test.ts` mock surface | `src/features/people/actions.test.ts:1-50` (current `requireRole`/`assertCan` mock setup) | The mock target shifts from `@/lib/auth/assert-can` to `@/lib/actions/action-client` (the middleware now owns the call). Anchor shows what `vi.mock` block needs to change. |
| Bulk migration target list (Phase 3) | `src/features/people/actions.ts`, `src/features/email/actions.ts`, the 6 lookup actions in `src/features/schedule/actions.ts:407-540`, `cancelCampaign`, `createCampaign`/`updateCampaign`, `createPerson`/`updatePerson`/`archivePerson`/`adoptOrphanAuthUser`, `production/export/route.ts` | All currently-gated Server Actions or Route Handlers — see `auth.md` § "Per-action gate matrix" for the canonical list. Phase 3 walks the list and migrates each. |
| Wiki update — `docs/wiki/auth.md` § "Capability gating" + § "Per-action gate matrix" | `docs/wiki/auth.md` § "Route gating (RBAC)" layer 4 | The fourth gate layer that 0029 added still applies — capability strings are unchanged. What changes is the *invocation* pattern (middleware chain, not line-1 imperative call). Update the prose so future readers don't go looking for `assertCan` calls that have moved to `.use()` chains. |

**Conventions referenced:**
- `docs/wiki/auth.md` — § "Route gating (RBAC)" describes the four enforcement layers; this chunk doesn't add a layer, it changes how layer 3 (action) is invoked.
- `docs/wiki/auth.md` — § "Capability matrix" is unchanged; capability strings survive the migration unmodified.
- `docs/wiki/security.md` § "Defence in depth" layer 3 — the **intent vs enforcement** distinction holds; middleware doesn't change which side of the line `<Can>` sits on.
- `CLAUDE.md` → "Mutations go through Server Actions, not route handlers" — Route Handlers (`production/export/route.ts`) get their own variant of the safe-action shape (no FormData parsing, but auth + capability middleware still applies).

**Overall Progress:** 80% (4/5 phases shipped; Phase 4 deferred as carry-forward)

**Note:**
- This is a **wiring + retrofit chunk**, not a feature. No new user-visible behavior; the gain is **error-class reduction** (missing-gate, drifted-gate, asymmetric-Can/assertCan all become harder to ship).
- Capability layer (0029) is forward-compatible: `assertCan` becomes a middleware factory, capability strings unchanged. No `capabilities.ts` edits.
- Each phase ends with `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.
- Bulk migration in Phase 3 is mechanical but **touches the most-tested surface in the app**. Run the per-action test after each migrated action; don't batch the test runs.

## Open Questions

1. **Standard Schema validator pick — Zod by default vs Valibot for bundle-size sensitive surfaces?**
   - *Working assumption:* Zod for v1 (matches the team's mental model + ecosystem familiarity + we already have nothing-installed so the Zod bundle is the new floor). Reconsider Valibot specifically for `0016-book-your-event-intake` (public-facing form, larger bundle penalty) — `next-safe-action` accepts both via Standard Schema, so the choice is per-action, not per-app.

2. **Action result shape migration — how do `useActionState` consumers adapt?**
   - Current shape: `{ok: true} | {error: string}`. After: `{data?, validationErrors?, serverError?}`.
   - *Working assumption:* a thin adapter helper (`toLegacyResult(safeActionResult) → {ok|error}`) lives temporarily in `src/lib/actions/` so callers migrate one-by-one rather than in a flag day. Adapter retires when last caller is updated. Decide before Phase 3 commits.

3. **Migration scope — all ~20 actions, or only new/touched ones?**
   - *Working assumption:* full migration in Phase 3 (the cost of two coexisting patterns is higher than the cost of finishing the migration). The capability-test matrix (parked follow-up `0032`-shaped) is easier to write against one uniform shape.

4. **Co-existence period strategy.**
   - During Phase 2 → 3, the codebase has both shapes in flight. How do we keep the lint rule (parked `0031`-shaped) from firing on the unmigrated half?
   - *Working assumption:* lint rule defers until Phase 3 completes. If the lint chunk lands first, its allow-list includes both `assertCan` and the safe-action middleware until this chunk closes.

5. **Where does the action client live — `src/lib/actions/` or `src/lib/auth/`?**
   - *Working assumption:* new directory `src/lib/actions/` — auth is one ingredient (the middleware), but the client is also about validation, error mapping, result shape. Auth-helpers (`assert-can.ts`, `require-role.ts`) stay in `src/lib/auth/`; the wrapping client lives one layer up.

6. **Route Handlers (`production/export/route.ts`) — same client, or a separate variant?**
   - Route Handlers don't run through the layout, don't take FormData, and return `Response`. `next-safe-action` is form-action-shaped; reusing the middleware on a Route Handler needs some adaptation.
   - *Working assumption:* Route Handlers continue to call `await assertCan('production:export')` directly — keep them on the existing imperative pattern, since the client's value-add (FormData parsing, result shape) doesn't apply. Document the carve-out in `auth.md` so it's intentional, not an oversight.

7. **Type-safe resource binding for resource-relative capabilities.**
   - Today `assertCan('coach-availability:edit-own', resource)` accepts `resource: unknown`. Middleware composition is a natural place to add a `CapabilityResourceMap` so TS catches "forgot to pass the row" mistakes at compile time.
   - *Working assumption:* in scope for Phase 1's middleware design — fold the typed-resource shape into the `capabilityClient(cap)` factory's signature. Defer if it adds more than ~30 lines; otherwise ship in this chunk.

8. **Migration timing vs `0016` vs the parked `0031` (lint rule).**
   - This chunk was originally pitched as "migrate when 0016 forces it." User is doing it independently as risk-reduction. That's defensible — but the lint rule (parked) and matrix tests (parked) are higher-leverage *per dollar*; revisit ordering if either is also queued. Carry-forward.

## Phase Checklist

### Phase 1: Install + bootstrap `action-client.ts`

- [ ] `pnpm add next-safe-action zod` (lock the major version of next-safe-action; check changelog for v8+ breaking changes vs the version current as of plan-start).
- [ ] Create `src/lib/actions/action-client.ts` — exports:
  - `baseClient` — bare `createSafeActionClient()` with default error handler that maps server errors to a `{serverError: string}` shape consistent with the toast UX.
  - `authedClient` — `.use()` chain that runs `await getUser()`; redirects `/login` on no user; injects `ctx: { user }`.
  - `adminClient` — extends `authedClient` with `await assertCan(...)` for any admin-only action; resolves capability per `.metadata({capability: 'X'})` or per-action override.
  - `capabilityClient(cap, resourceMap?)` — factory taking a capability + optional typed resource shape; resolves to a chain that calls `assertCan(cap, resource)` and injects typed `ctx.user`.
- [ ] `src/lib/actions/action-client.test.ts` — table-driven test of each tier: unauth → redirect, denied capability → redirect, allowed → next() with typed ctx.
- [ ] **Decide Open Question 5** (location): if `src/lib/actions/` doesn't exist yet, create it; otherwise consolidate.
- [ ] **Decide Open Question 7** (typed resource map): in scope or carry-forward to a follow-up chunk?
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 2: Pilot migration — dealer CRUD

- [ ] `src/features/schedule/actions.ts` — rewrite `createDealer`, `updateDealer`, `archiveDealer` using `adminClient` (already admin-only post-2026-05-08 tightening).
  - Define Zod schemas inline (or in a new `src/features/dealers/schemas.ts` if size warrants).
  - Replace `parseDealerInput` / `parseId` / `field` calls with `parsedInput`.
  - Keep `userId = ctx.user.id` for audit columns (the action body is otherwise unchanged).
- [ ] `src/features/dealers/dealer-form.tsx` — update `useActionState` to consume the new `{data, validationErrors, serverError}` shape. Map `serverError` to toast, `validationErrors` to inline field errors.
- [ ] **If Open Question 2 → adapter:** add `toLegacyResult` in `src/lib/actions/` so other dealer-action callers (none today, but defensive) can transition incrementally.
- [ ] Update mocks in any dealer-action test to mock the safe-action wrapper rather than the helpers it composes (anchor: existing `vi.mock('@/lib/auth/assert-can', ...)` blocks).
- [ ] Smoke (web-test, **as admin**): `goto /dealerships`; click `+ Add Dealer`; dialog with dealer-form fields; type a duplicate name and submit; expect inline `validationErrors` rendered (or toast, depending on chosen shape) without a redirect.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 3: Bulk migration — people / lookup / campaign / email / production-export

- [ ] **Person actions** (4 sites in `src/features/people/actions.ts`): `createPerson`, `updatePerson`, `archivePerson`, `adoptOrphanAuthUser` → `adminClient` + Zod schemas.
- [ ] **Lookup actions** (6 sites in `src/features/schedule/actions.ts:407-540`): all 6 → `adminClient.metadata({capability: 'lookup:edit'})` or `capabilityClient('lookup:edit')`.
- [ ] **Campaign actions** (`createCampaign`, `updateCampaign`, `cancelCampaign`): all admin-only post-2026-05-08; migrate to `adminClient` with capability metadata.
- [ ] **Email actions** (`sendClientCampaignConfirmation`, `sendCoachCampaignConfirmation`, `sendCoachShareLinkEmail`): migrate the shared `requireSenderEmail()` helper into the middleware chain — `adminClient.use(({ctx, next}) => { if (!ctx.user.email) return {error: 'No email on file'}; return next({ctx}); })`.
- [ ] **Availability blocks** (`createAvailabilityBlock`, `updateAvailabilityBlock`, `archiveAvailabilityBlock`) — these stay on `requireRole(['admin','coach'])` + `ensureAvailabilityOwnership`. Migrate to `capabilityClient('coach-availability:edit-own', facetResource)` so the middleware threads the typed resource through.
- [ ] **Production export Route Handler** (`src/app/(app)/production/export/route.ts`) — per Open Question 6's working assumption, **leave on `assertCan`** unless the chunk decides otherwise mid-flight.
- [ ] Update every consumer `useActionState` hook to read the new shape. Touch sites: `people-admin.tsx`, `dealer-form.tsx` (Phase 2), `lookup-admin.tsx`, `event-detail.tsx`, `booking-form.tsx`, calendar `availability-form.tsx`.
- [ ] Update test mocks in: `people/actions.test.ts`, `email/actions.test.ts`, `availability-authz.test.ts`, any other `vi.mock('@/lib/auth/...')` block touching action call sites.
- [ ] Per-action sanity: after each migrated action, run *its* existing test suite (don't wait for the full run at end). Revert any action whose tests fail and isolate the diff.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 4: Retire hand-rolled validators (DEFERRED — carry-forward)

Phase 4 was scoped as "replace `field()` / `parseId()` / `parseLookupLabel()` / `validateContactInputs()` / `parseCampaignInput()` with Zod schemas everywhere; delete `validators.ts`." That requires writing 12+ field-level Zod schemas that match the existing semantics (required-field rules, length caps, email regex, ID coercion, multi-role parsing, dealer-link JSON parsing) and rewriting every action body to read `parsedInput.field` instead of calling the parser. Substantial work; not required for the safety-net win Phase 1–3 already delivered.

**Carry-forward**: revisit when `0016-book-your-event-intake` lands (public-facing form, untrusted input, natural fit for Zod schemas). Until then, actions use the `formDataSchema` passthrough — the safe-action client validates "is FormData" via `z.instanceof(FormData)`, the action body keeps the existing `field()` / `parseId()` calls. The legacy-result adapter (`toLegacyResult`) stays in place for the same reason.

Items left for the deferred follow-up (cite this carry-forward when you scope it):
- [ ] Write per-action Zod schemas (dealer create/update, person create/update, campaign create/update, lookup label, availability block).
- [ ] Replace `parseDealerInput` / `parseCampaignInput` / `parseAvailabilityInput` with the matching schema's `parsedInput`.
- [ ] Delete `src/features/schedule/validators.ts` once no Server Action imports it.
- [ ] If every form consumer migrates to read `serverError` / `validationErrors` directly, delete `src/lib/actions/legacy-result.ts`.

### Phase 5: Wiki update + smoke + close

- [ ] `docs/wiki/auth.md` § "Capability gating: actions + UI affordances" — rewrite to describe the middleware-chain shape; replace inline `await assertCan(...)` example with a `adminClient.action(...)` example. Capability strings are unchanged.
- [ ] `docs/wiki/auth.md` § "Per-action gate matrix" — update the *implementation* column to read `adminClient + capability:'X'` (or `capabilityClient('X')`) where applicable. The role/capability admit set is unchanged.
- [ ] `docs/wiki/security.md` layer 3 — update the function names and example to reflect middleware chains; preserve the **intent vs enforcement** caveat.
- [ ] `docs/wiki/log.md` — append-only entry for the chunk.
- [ ] Update `CLAUDE.md` "Mutations go through Server Actions, not route handlers" — note the safe-action client convention so future contributors know the canonical shape.
- [ ] Full vitest suite green; tsc + lint clean.
- [ ] Smoke (web-test, **as admin**): `goto /admin/people`; click `+ Add Person`; fill form; submit; expect toast on success (validation errors shown inline if name empty, etc.).
- [ ] Smoke (web-test, **as admin**): `goto /admin/lookups`; add a new style; rename it; archive it — verify each surfaces the new result shape correctly.
- [ ] Smoke (web-test, **as admin**): `goto /calendar`; click `+ Book Event`; fill form; submit; verify the booking lands and the calendar refreshes.
- [ ] Confirm `docs/wiki/auth.md` rewrite reads cleanly: future reader can follow "where do I add a new gated action?" → answer is `adminClient.schema(z…).action(…)` with capability metadata.
