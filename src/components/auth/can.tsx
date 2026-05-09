'use client';

import { useContext, type ReactNode } from 'react';
import type { Capability } from '@/lib/auth/capabilities';
import { CapabilityContext } from './capability-provider';

// `useCan` returns false outside the provider — deny by default. Mirrors
// `can()`'s contract for null profiles. Components reaching this fall-through
// is usually a bug (provider not mounted) but failing closed is the safe shape.
export function useCan(capability: Capability, resource?: unknown): boolean {
  const ctx = useContext(CapabilityContext);
  if (!ctx) return false;
  return ctx.can(capability, resource);
}

type CanProps = {
  capability: Capability;
  resource?: unknown;
  fallback?: ReactNode;
  children: ReactNode;
};

// Hide-by-default render gate. Most denials in this app are role-based (a
// coach won't ever have admin), and rendering-then-hiding causes layout flash.
// Disable-with-tooltip is opt-in via `<Can ... fallback={…}>`. Pair every
// `<Can>` with a server-side `assertCan` (or `capabilityClient` factory) in
// the action it triggers — `<Can>` is intent affordance, not enforcement.
export function Can({ capability, resource, fallback, children }: CanProps) {
  const allowed = useCan(capability, resource);
  if (allowed) return <>{children}</>;
  return <>{fallback ?? null}</>;
}
