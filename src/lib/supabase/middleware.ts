import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// `/api/boldsign/webhook` is an external caller (BoldSign POSTs here with no
// session cookie); it has its own HMAC gate inside the handler, so it must
// bypass the session-auth redirect or every webhook 307s to /login.
const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/auth/auth-error',
  '/share/coach',
  '/api/boldsign/webhook',
];
const ADMIN_PATHS = ['/admin', '/production', '/dealerships'];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isAdminUser(role: unknown): boolean {
  return role === 'admin';
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Per @supabase/ssr docs: don't add logic between createServerClient and getUser
  // — anything that touches cookies in between can desync the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // First defence-in-depth gate for /admin/*. Page-level admin:access
  // capability and each Server Action's capability gate are the deeper
  // layers — same admin admit-set consulted everywhere.
  if (user && isAdminPath(request.nextUrl.pathname) && !isAdminUser(user.app_metadata?.role)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
