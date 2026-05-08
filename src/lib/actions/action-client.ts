import 'server-only';
import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
  isNavigationError,
} from 'next-safe-action';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertCan } from '@/lib/auth/assert-can';
import type { Capability } from '@/lib/auth/capabilities';
import { requireRole } from '@/lib/auth/require-role';
import type { TeamMemberRole } from '@/lib/auth/load-team-membership';
import { getUser } from '@/lib/supabase/session';

// Tiered safe-action client. Composes the existing auth helpers
// (`getUser` / `assertCan` / `requireRole`) into next-safe-action middlewares
// so the auth-required path is the *default* — writing an unauthed action
// requires explicit opt-out (`baseClient`), the inverse of the older "remember
// to add the gate" shape. Capability strings (0029) are unchanged.
//
// 0033 Phase 1. See docs/designs/0033-next-safe-action/plan.md.
//
// Tiers:
//   - `baseClient` — no auth. Reserved for the auth-flow itself
//     (signInWithMagicLink, signInWithGoogle, signOut). The 0031 lint rule
//     opt-out (`// authz: public`) marks call sites.
//   - `authedClient` — requires a signed-in user. Redirects `/login` on no
//     user. Injects `ctx.user`.
//   - `capabilityClient(cap)` — extends `authedClient` with `assertCan(cap)`;
//     redirects `/` on capability deny. Use this for every gated action that
//     maps to a capability in `src/lib/auth/capabilities.ts`.
//   - `roleListClient(roles)` — extends `authedClient` with
//     `requireRole(roles)` for the legacy multi-role admit-set carve-outs
//     (today: `availability` actions admitting `['admin','coach']`). Capability
//     migration of these is parked — the matrix lives in `requireRole` for
//     now.

export const baseClient = createSafeActionClient({
  handleServerError(error: unknown) {
    // Let Next.js navigation errors (redirect / notFound) propagate so the
    // existing redirect-on-deny semantics survive the middleware boundary.
    if (isNavigationError(error)) throw error;
    if (error instanceof Error) return error.message;
    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
});

export const authedClient = baseClient.use(async ({ next }) => {
  const user = await getUser();
  if (!user) redirect('/login');
  return next({ ctx: { user } });
});

// Factory: returns a client that runs `assertCan(cap)` ahead of the action
// body. The redirect-on-deny path matches the imperative `await assertCan(...)`
// it replaces (0029 → /login on no user, / on cap deny).
export function capabilityClient(cap: Capability) {
  return authedClient.use(async ({ ctx, next }) => {
    await assertCan(cap);
    return next({ ctx });
  });
}

// Factory: legacy role-list admit set (where capability semantics don't
// tighten intent). Today: `availability` actions admitting both admin and
// coach. The row-ownership check (`coach-availability:edit-own`) still runs
// inside the action body via `ensureAvailabilityOwnership`.
export function roleListClient(roles: TeamMemberRole | TeamMemberRole[]) {
  return authedClient.use(async ({ ctx, next }) => {
    await requireRole(roles);
    return next({ ctx });
  });
}

// Passthrough schema for actions whose input is the raw FormData. The action
// body keeps the existing `field()` / `parseId()` parsing for now; Phase 4
// of 0033 replaces these schemas with field-level Zod and retires the
// hand-rolled parsers. Until then this lets every action go through a uniform
// safe-action shape without rewriting form-parsing in one shot.
export const formDataSchema = z.instanceof(FormData);
