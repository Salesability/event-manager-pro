import type { User } from '@supabase/supabase-js';
import { isStaffAppRole, type TeamMemberRole } from '@/lib/auth/team-roles';

// Pure capability PDP. Decides whether a profile holds a capability against
// an optional resource. No DB calls, no auth lookups — caller loads the
// profile (typically via loadCurrentMembership) and passes it in.
//
// Capability format: `subject:verb`. Matches OpenFGA / Cedar convention and
// keeps grep grouped by surface area at the top of output. Admin is a meta:
// an admin profile passes every capability — admins skip resource-relative
// branches like coach-availability:edit-own's row-ownership check.
//
// No `'server-only'` directive: this module is the shared decision layer.
// The server PEP (`assert-can.ts`) and the client PEP (`<Can>` / `useCan`)
// both import from here so the matrix lives in exactly one place.

export type Capability =
  | 'app:access'
  | 'admin:access'
  | 'reports:view'
  | 'reports:edit-billing'
  | 'availability:edit'
  | 'production:view'
  | 'production:export'
  | 'dealer:view'
  | 'dealer:edit'
  | 'dealer:create'
  | 'dealer:archive'
  | 'person:view'
  | 'person:create'
  | 'person:edit'
  | 'person:archive'
  | 'person:adopt-orphan'
  | 'lookup:edit'
  | 'campaign:create'
  | 'campaign:edit'
  | 'campaign:cancel'
  | 'quote:edit'
  | 'msa:edit'
  | 'msa:read'
  | 'email:send'
  | 'coach-availability:edit-own'
  | 'coach-availability:edit-any';

export type CapabilityProfile = {
  user: User | null;
  roles: TeamMemberRole[];
  coachContactId: number | null;
};

export type CoachAvailabilityResource = {
  kind: 'statutory_holiday' | 'company_closure' | 'coach_unavailable';
  coachId: number | null;
};

export function can(
  profile: CapabilityProfile | null,
  capability: Capability,
  resource?: unknown,
): boolean {
  if (!profile?.user) return false;

  // Admin shortcut. Either the JWT app_metadata.role (bootstrap path —
  // works pre-team_member_roles row) or a role row containing 'admin' admits
  // everything. Mirrors the cross-layer admin convention.
  const isAdmin =
    profile.user.app_metadata?.role === 'admin' ||
    profile.roles.includes('admin');
  if (isAdmin) return true;

  switch (capability) {
    case 'app:access': {
      // Staff-app shell access. Delegates to `isStaffAppRole` (the same
      // predicate `requireStaffAccess()` and the auth-callback router use)
      // so swapping `requireStaffAccess()` for `assertCan('app:access')`
      // preserves admit-set semantics by construction. `dealer` is them-side
      // and excluded by `STAFF_APP_ROLES`.
      return profile.roles.some(isStaffAppRole);
    }
    case 'reports:view':
    case 'availability:edit':
    case 'quote:edit':
    case 'msa:edit': {
      // Admin || coach. Admin already passed via the shortcut above; check
      // the membership roles for coach. Coaches own their own quotes per the
      // multi-tenant-by-coach model; admins can edit any quote. `msa:edit`
      // mirrors `quote:edit` — the coach who owns the Client is the one who
      // creates / sends MSAs for that Client.
      return profile.roles.includes('coach');
    }
    case 'msa:read': {
      // Read-side: admin || coach || viewer. The MSA panel on
      // `/dealerships/[id]` is informational; viewer roles see status + signed
      // date without being able to send. `app:access` already excludes
      // `dealer`, so reaching here means a staff role.
      return (
        profile.roles.includes('coach') || profile.roles.includes('viewer')
      );
    }
    case 'admin:access':
    case 'reports:edit-billing':
    case 'production:view':
    case 'production:export':
    case 'dealer:view':
    case 'dealer:edit':
    case 'dealer:create':
    case 'dealer:archive':
    case 'person:view':
    case 'person:create':
    case 'person:edit':
    case 'person:archive':
    case 'person:adopt-orphan':
    case 'lookup:edit':
    case 'campaign:create':
    case 'campaign:edit':
    case 'campaign:cancel':
    case 'email:send':
    case 'coach-availability:edit-any':
      // Pure-admin caps. Already handled by the shortcut above; reaching
      // here means the profile is not admin → deny.
      return false;
    case 'coach-availability:edit-own': {
      // A coach can edit only their own coach_unavailable rows. Holiday and
      // company-closure rows are admin-only (would be `:edit-any`); a coach
      // touching another coach's row is denied even if the resource kind
      // matches.
      const isCoach = profile.roles.includes('coach');
      if (!isCoach || profile.coachContactId == null) return false;
      const facet = resource as CoachAvailabilityResource | undefined;
      if (!facet) return false;
      return (
        facet.kind === 'coach_unavailable' &&
        facet.coachId === profile.coachContactId
      );
    }
  }
}
