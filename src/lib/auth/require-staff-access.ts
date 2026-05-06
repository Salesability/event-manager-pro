import 'server-only';
import { redirect } from 'next/navigation';
import {
  isStaffAppRole,
  loadCurrentMembership,
} from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';
import { getUser } from '@/lib/supabase/session';

// Single staff-app access check. Used by `(app)/layout.tsx` (covers all
// pages) and by Route Handlers under `(app)/*` (which Next does NOT route
// through the layout) so a `/production/export` GET can't bypass the gate
// by virtue of being a non-page surface.
//
// Returns the authenticated user on success; throws `redirect(...)` from
// next/navigation otherwise — same control-flow shape as `requireAdmin`.
export async function requireStaffAccess() {
  const user = await getUser();
  if (!user) redirect('/login');

  // Admins always pass — `app_metadata.role` lives on the JWT and survives
  // before any `team_member_roles` row exists (bootstrap path).
  if (isAdmin(user)) return user;

  // Filter out `dealer` rows: a dealer-only person is them-side and must NOT
  // land on the staff app. Closes the 0023 Phase 1 Codex High where adding
  // `dealer` to the enum would have aliased dealer rows as staff via the
  // earlier `roles.length > 0` check.
  const membership = await loadCurrentMembership();
  const hasStaffRole = membership?.roles.some(isStaffAppRole) ?? false;
  if (!hasStaffRole) {
    const reason = membership?.hasDealerContact
      ? 'Portal not yet available'
      : 'Account not provisioned';
    redirect(`/auth/auth-error?reason=${encodeURIComponent(reason)}`);
  }

  return user;
}
