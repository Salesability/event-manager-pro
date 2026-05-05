import 'server-only';
import { redirect } from 'next/navigation';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
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

  const membership = await loadCurrentMembership();
  if (!membership || membership.roles.length === 0) {
    const reason = membership?.hasDealerContact
      ? 'Portal not yet available'
      : 'Account not provisioned';
    redirect(`/auth/auth-error?reason=${encodeURIComponent(reason)}`);
  }

  return user;
}
