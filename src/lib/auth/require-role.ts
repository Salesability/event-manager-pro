import 'server-only';
import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import {
  loadCurrentMembership,
  type TeamMemberRole,
} from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';
import { getUser } from '@/lib/supabase/session';

// Generalises `requireAdmin` to any team-member role (or set of roles). The
// 'admin' role is matched via the JWT `app_metadata.role` claim — fast path
// that works pre-`team_member_roles`-row in the bootstrap case. Other roles
// route through `loadCurrentMembership()` so the lookup honours archive state.
//
// Same redirect-on-fail control flow as `requireAdmin`: `/login` if not signed
// in, `/` if signed in but lacking every requested role. Returns the User on
// success so callers can use `user.id` for audit columns and `user.email` for
// `replyTo` on outbound mail.
export async function requireRole(
  role: TeamMemberRole | TeamMemberRole[],
): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');

  const allowed = Array.isArray(role) ? role : [role];

  if (allowed.includes('admin') && isAdmin(user)) return user;

  const membership = await loadCurrentMembership();
  if (!membership) redirect('/');

  const hasRole = membership.roles.some((r) => allowed.includes(r));
  if (!hasRole) redirect('/');

  return user;
}
