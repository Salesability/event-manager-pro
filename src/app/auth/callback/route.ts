import { NextResponse, type NextRequest } from 'next/server';
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

  return NextResponse.redirect(new URL(next, url));
}
