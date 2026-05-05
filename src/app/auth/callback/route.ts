import { NextResponse, type NextRequest } from 'next/server';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/url';

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(new URL('/auth/auth-error?reason=Missing+code', url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const errorUrl = new URL('/auth/auth-error', url);
    errorUrl.searchParams.set('reason', error.message);
    return NextResponse.redirect(errorUrl);
  }

  // Decide where to land the user based on their domain role.
  //   - Any team_member_roles row → staff app at `next` (default `/`).
  //   - No team_member_roles but ≥1 active dealer_contacts row → them-side
  //     (portal). The portal route doesn't ship in 0018, so for now we land
  //     them on a friendly "not yet available" page — when the portal opens
  //     this redirect target swaps to `/portal` (one-line change).
  //   - Neither → defensive "not provisioned" error. Shouldn't happen with
  //     project-level signups disabled, but if a stray auth.users row exists
  //     we'd rather flag it than render a half-broken staff app.
  //
  // Note: the same decision tree runs in `(app)/layout.tsx` so it stays
  // durable after this first redirect — see docs/wiki/auth.md "Login routing".
  const membership = await loadCurrentMembership();
  if (membership && membership.roles.length > 0) {
    return NextResponse.redirect(new URL(next, url));
  }

  const errorUrl = new URL('/auth/auth-error', url);
  errorUrl.searchParams.set(
    'reason',
    membership?.hasDealerContact ? 'Portal not yet available' : 'Account not provisioned',
  );
  return NextResponse.redirect(errorUrl);
}
