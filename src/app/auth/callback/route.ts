import { NextResponse, type NextRequest } from 'next/server';
import {
  isStaffAppRole,
  loadCurrentMembership,
} from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/session';
import { safeNextPath } from '@/lib/url';

// Cloud Run forwards requests to the container on 0.0.0.0:3000, so
// `request.nextUrl` reflects that internal address rather than the public
// origin — building redirects against it sends users to https://0.0.0.0:3000.
// Resolve the real origin from SITE_URL (set on the service), falling back to
// the x-forwarded-* headers, then to the request origin for local dev. Mirrors
// the `siteUrl()` helper in src/features/auth/actions.ts.
function resolveOrigin(request: NextRequest): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

// authz: public — OAuth-code exchange runs before any session exists.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = resolveOrigin(request);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(new URL('/auth/auth-error?reason=Missing+code', origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const errorUrl = new URL('/auth/auth-error', origin);
    errorUrl.searchParams.set('reason', error.message);
    return NextResponse.redirect(errorUrl);
  }

  // Decide where to land the user based on their domain role.
  //   - `app_metadata.role === 'admin'` → staff app at `next` (admin bootstrap
  //     path: an admin can sign in before any team_member_roles row exists,
  //     mirroring the layout gate).
  //   - Any team_member_roles row → staff app at `next` (default `/`).
  //   - No roles, ≥1 active dealer_contacts row → them-side (portal). The
  //     portal route doesn't ship in 0018, so for now we land them on a
  //     friendly "not yet available" page — when the portal opens this
  //     redirect target swaps to `/portal` (one-line change).
  //   - Neither → defensive "not provisioned" error.
  //
  // Note: the same decision tree runs in `(app)/layout.tsx` so it stays
  // durable after this first redirect — see docs/wiki/auth.md "Login routing".
  const user = await getUser();
  if (isAdmin(user)) {
    return NextResponse.redirect(new URL(next, origin));
  }

  const membership = await loadCurrentMembership();
  // `dealer` rows are excluded so a dealer-only person doesn't accidentally
  // land on the staff app — see require-staff-access.ts for the matching
  // filter, drizzle/0006_*.sql for the matching SQL `is_staff_member()`.
  if (membership && membership.roles.some(isStaffAppRole)) {
    return NextResponse.redirect(new URL(next, origin));
  }

  const errorUrl = new URL('/auth/auth-error', origin);
  errorUrl.searchParams.set(
    'reason',
    membership?.hasDealerContact ? 'Portal not yet available' : 'Account not provisioned',
  );
  return NextResponse.redirect(errorUrl);
}
