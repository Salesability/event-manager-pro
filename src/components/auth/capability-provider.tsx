'use client';

import { createContext, useMemo, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  can,
  type Capability,
  type CapabilityProfile,
} from '@/lib/auth/capabilities';
import type { TeamMemberRole } from '@/lib/auth/load-team-membership';

// Client-side PEP context. Mounted once in `(app)/layout.tsx` from the same
// `loadCurrentMembership` data the layout already loads — no extra DB hits.
// Holds the request profile + a bound `can()` predicate for `useCan` / `<Can>`
// to consume. Server-side actions still call `assertCan()` (the load-bearing
// gate); the client surface is intent-keyed affordance hiding, not enforcement.

export type CapabilityContextValue = {
  profile: CapabilityProfile;
  can: (capability: Capability, resource?: unknown) => boolean;
};

export const CapabilityContext = createContext<CapabilityContextValue | null>(
  null,
);

type Props = {
  user: User | null;
  roles: TeamMemberRole[];
  coachContactId: number | null;
  children: ReactNode;
};

export function CapabilityProvider({
  user,
  roles,
  coachContactId,
  children,
}: Props) {
  const value = useMemo<CapabilityContextValue>(() => {
    const profile: CapabilityProfile = { user, roles, coachContactId };
    return {
      profile,
      can: (capability, resource) => can(profile, capability, resource),
    };
  }, [user, roles, coachContactId]);

  return (
    <CapabilityContext.Provider value={value}>
      {children}
    </CapabilityContext.Provider>
  );
}
