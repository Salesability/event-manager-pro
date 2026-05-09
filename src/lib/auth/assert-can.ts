import 'server-only';
import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import {
  can,
  type Capability,
  type CapabilityProfile,
} from '@/lib/auth/capabilities';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { getUser } from '@/lib/supabase/session';

// Server PEP for capability checks. Loads user + membership, calls can(),
// either returns the user (allow) or redirects /login (no user) / /
// (denied). Canonical authorization gate at the application layer; pages,
// Route Handlers, and the `capabilityClient` middleware factory all delegate
// here. The single capability matrix lives in `capabilities.ts`.
export async function assertCan(
  capability: Capability,
  resource?: unknown,
): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');

  // loadCurrentMembership is React-cached for the request, so multiple
  // assertCan calls in the same Server Action share one DB round-trip.
  const membership = await loadCurrentMembership();
  const profile: CapabilityProfile = {
    user,
    roles: membership?.roles ?? [],
    coachContactId: membership?.coachContactId ?? null,
  };

  if (!can(profile, capability, resource)) redirect('/');
  return user;
}
