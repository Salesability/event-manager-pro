// Pure team-role constants. Lives outside `load-team-membership.ts` (which is
// `'server-only'`) so the client-safe capability decision layer
// (`capabilities.ts` → imported by `<Can>` / `useCan`) can call the same
// `isStaffAppRole` predicate as the server gates and stay in sync.
//
// Single source of truth for the staff-app admit set. Mirrored by the SQL
// `is_staff_member()` helper (drizzle/0006_is_staff_member_excludes_dealer.sql)
// so RLS policies and the app-layer gate agree on what "staff" means.

export type TeamMemberRole = 'admin' | 'staff' | 'coach' | 'viewer' | 'dealer';

// Roles that grant staff-app access. `dealer` is deliberately excluded — a
// person with the `dealer` role is them-side (a contact at a dealership), not
// us-side, and must not pass `requireStaffAccess()` or `assertCan('app:access')`.
export const STAFF_APP_ROLES: readonly TeamMemberRole[] = [
  'admin',
  'staff',
  'coach',
  'viewer',
];

export function isStaffAppRole(role: TeamMemberRole): boolean {
  return (STAFF_APP_ROLES as readonly string[]).includes(role);
}
