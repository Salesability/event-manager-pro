import 'server-only';
import type { User } from '@supabase/supabase-js';
import { can, type CoachAvailabilityResource } from '@/lib/auth/capabilities';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';

export type AvailabilityFacet = CoachAvailabilityResource;

// Soft-error variant of `assertCan('coach-availability:edit-own', facet)` for
// the `*AvailabilityBlock` Server Actions. Where assertCan would redirect on
// deny, this returns `{ error }` for toast feedback — the right UX for "you
// tried to edit another coach's block" (closer to a validation error than an
// auth error).
//
// The decision is delegated to `can()` so the row-ownership rule lives in
// `capabilities.ts` (one canonical map). Admins skip the check via the
// admin-shortcut inside `can()`. For updates, callers pass BOTH the existing
// row's facet and the desired-input facet so a coach can't transfer ownership
// of their own block by changing `input.coachId` mid-edit. Returns `{ error }`
// on the first failing facet; `null` on success.
export async function ensureAvailabilityOwnership(
  user: User,
  ...facets: AvailabilityFacet[]
): Promise<{ error: string } | null> {
  const membership = await loadCurrentMembership();
  const profile = {
    user,
    roles: membership?.roles ?? [],
    coachContactId: membership?.coachContactId ?? null,
  };
  for (const facet of facets) {
    if (!can(profile, 'coach-availability:edit-own', facet)) {
      return { error: 'You can only modify your own availability.' };
    }
  }
  return null;
}
