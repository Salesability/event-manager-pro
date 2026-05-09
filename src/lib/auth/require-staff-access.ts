import 'server-only';
import { redirect } from 'next/navigation';
import { can, type CapabilityProfile } from '@/lib/auth/capabilities';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { getUser } from '@/lib/supabase/session';

// Layout-level staff-app gate with friendly auth-error redirects. Wraps the
// app:access capability predicate so the redirect UX (Portal-not-yet-
// available for dealer-only contacts, Account-not-provisioned for
// unprovisioned auth users) lives in one place. Today only the layout
// (`src/app/(app)/layout.tsx`) calls it; usable by Route Handlers under
// `(app)/*` if any future handler needs the same friendly redirects (Next
// does NOT route handlers through the layout).
//
// Why a wrapper rather than the bare PEP: assertCan redirects to `/` on deny,
// but `/` is inside `(app)/` and would loop on a dealer-only contact typing
// `/calendar` directly. The predicate is canonical (the same one assertCan
// would invoke); this function adds the redirect targets. Mirrors the auth-
// callback's own routing decisions in `src/app/auth/callback/route.ts`.
//
// Returns the authenticated user on success; throws `redirect(...)` from
// next/navigation otherwise.
export async function requireStaffAccess() {
  const user = await getUser();
  if (!user) redirect('/login');

  // loadCurrentMembership is React-cached for the request, so the layout's
  // own loadCurrentMembership() call below shares one DB round-trip.
  const membership = await loadCurrentMembership();
  const profile: CapabilityProfile = {
    user,
    roles: membership?.roles ?? [],
    coachContactId: membership?.coachContactId ?? null,
  };

  if (can(profile, 'app:access')) return user; // expected: server-only

  const reason = membership?.hasDealerContact
    ? 'Portal not yet available'
    : 'Account not provisioned';
  redirect(`/auth/auth-error?reason=${encodeURIComponent(reason)}`);
}
