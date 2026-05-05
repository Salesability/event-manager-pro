'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/url';

// User admin actions (`createUser`, `linkUserToContact`, `setUserRoles`,
// `deactivateUser`) retired in 0020 Phase 4. The People page (`/admin/people`)
// handles all four via `createPerson` / `updatePerson` / `archivePerson` in
// `src/features/people/actions.ts`. This file is now login-only.

async function siteUrl() {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function signInWithMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const next = safeNextPath(formData.get('next'));

  if (!email) {
    redirect('/login?error=Please+enter+your+email');
  }

  const callback = new URL('/auth/callback', await siteUrl());
  callback.searchParams.set('next', next);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callback.toString(),
      // Project-level signups are also off; this makes the failure mode louder
      // for emails not already in auth.users.
      shouldCreateUser: false,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/login?sent=${encodeURIComponent(email)}`);
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get('next'));

  const callback = new URL('/auth/callback', await siteUrl());
  callback.searchParams.set('next', next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? 'Google sign-in failed')}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
