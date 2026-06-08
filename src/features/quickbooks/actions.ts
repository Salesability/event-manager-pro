'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import {
  QBO_STATE_COOKIE,
  buildAuthorizeUrl,
  quickbooksRedirectUri,
  revokeToken,
} from '@/lib/quickbooks/client';
import { deleteConnection, getConnection } from '@/lib/quickbooks/connection';

// Connect-initiation + disconnect for the QuickBooks OAuth connection (chunk
// 0068). Both are admin-gated Server Actions per repo conventions (the Intuit
// *callback* is the route handler — external caller). The OAuth redirect itself
// is built here, mirroring `signInWithGoogle` in `src/features/auth/actions.ts`.

async function siteUrl(): Promise<string> {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const proto =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// authz: admin:access
// validation: skip — no FormData input; generates its own CSRF state.
export async function connectQuickbooks() {
  await assertCan('admin:access');

  const redirectUri = quickbooksRedirectUri(await siteUrl());
  const state = randomBytes(32).toString('base64url');
  // qboConfig() (inside buildAuthorizeUrl) throws when QBO_CLIENT_ID/SECRET are
  // unset. The page hides the Connect button until `qboConfigured()` is true,
  // so this is effectively unreachable from the UI — but if it does throw, let
  // it propagate (Next's error boundary) rather than swallow a real misconfig.
  const authorizeUrl = buildAuthorizeUrl(state, redirectUri);

  // httpOnly + sameSite=lax so the cookie rides along on Intuit's top-level
  // redirect back to the callback (where it's checked against the `state`
  // param). `secure` only in production — localhost dev is plain http.
  const cookieStore = await cookies();
  cookieStore.set(QBO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  redirect(authorizeUrl);
}

// authz: admin:access
// validation: skip — no FormData input.
export async function disconnectQuickbooks() {
  await assertCan('admin:access');

  const conn = await getConnection();
  if (conn) {
    try {
      await revokeToken(conn.refreshToken);
    } catch {
      // Best-effort revoke at Intuit; drop the local connection regardless so
      // the admin isn't stuck "connected" to a token we can't revoke.
    }
    await deleteConnection();
  }

  // The Disconnect button lives ON /admin/quickbooks — revalidate in place so
  // the page re-renders into the disconnected state (no redirect needed).
  revalidatePath('/admin/quickbooks');
}
