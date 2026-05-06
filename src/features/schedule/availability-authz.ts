import 'server-only';
import type { User } from '@supabase/supabase-js';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';

export type AvailabilityFacet = {
  kind: 'statutory_holiday' | 'company_closure' | 'coach_unavailable';
  coachId: number | null;
};

// Row-level ownership gate on top of `requireRole(['admin','coach'])` for the
// `*AvailabilityBlock` Server Actions. Admins can mutate any block; a coach
// can only mutate their own `coach_unavailable` rows — never holidays,
// company closures, or another coach's unavailability. For updates, callers
// pass BOTH the existing row's facet and the desired-input facet so a coach
// can't transfer ownership of their own block by changing `input.coachId`.
// Returns `{ error }` on the first failing facet; `null` on success.
export async function ensureAvailabilityOwnership(
  user: User,
  ...facets: AvailabilityFacet[]
): Promise<{ error: string } | null> {
  if (isAdmin(user)) return null;
  const membership = await loadCurrentMembership();
  const myCoachId = membership?.coachContactId;
  if (myCoachId == null) {
    return { error: 'You can only modify your own availability.' };
  }
  for (const facet of facets) {
    if (facet.kind !== 'coach_unavailable' || facet.coachId !== myCoachId) {
      return { error: 'You can only modify your own availability.' };
    }
  }
  return null;
}
