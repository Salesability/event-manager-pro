'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertCan } from '@/lib/auth/assert-can';
import {
  QBO_STATE_COOKIE,
  buildAuthorizeUrl,
  fetchCustomers,
  quickbooksRedirectUri,
  revokeToken,
} from '@/lib/quickbooks/client';
import { deleteConnection, getConnection, getValidAccessToken } from '@/lib/quickbooks/connection';
import { pushDealerToQuickbooks as pushDealerToQbo } from '@/lib/quickbooks/dealer-push';
import { applyDealerSync, encodeSyncSummary } from '@/lib/quickbooks/dealer-sync';
import { loadDealer } from '@/features/schedule/queries';

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

// authz: admin:access
// validation: skip — no FormData input; reads the live QB customer list and
// applies the computed dealer change set.
//
// Reconciles the connected company's QuickBooks customers into `dealers`
// (chunk 0069): match-by-QB-ID → match-by-name+address & backfill → insert.
// On success, redirects with `?synced=<created>.<linked>.<skipped>` so the page
// flashes a summary and re-renders the recomputed (now mostly already-linked)
// plan. Errors (not connected / token refresh / fetch) propagate to Next's
// error boundary rather than being caught-and-redirected — the Sync button only
// renders once the page has already loaded the customer list (so the token is
// fresh), making a sync-time failure rare, and a post-gate redirect would read
// as a wrong gate-admit to the action-gate-matrix suite.
export async function syncDealersFromQuickbooks() {
  const user = await assertCan('admin:access');

  const { realmId, accessToken } = await getValidAccessToken();
  const customers = await fetchCustomers(realmId, accessToken);
  const result = await applyDealerSync(customers, user.id);

  revalidatePath('/admin/quickbooks');
  redirect(`/admin/quickbooks?synced=${encodeSyncSummary(result)}`);
}

const pushDealerSchema = z.object({
  dealerId: z.coerce.number().int().positive(),
});

// authz: admin:access
// validation: Zod — `dealerId` (positive int) from the dealer-page form.
//
// Push a single in-app dealer TO QuickBooks (chunk 0070 — the reverse of the
// 0069 sync): linked dealer → update the QBO Customer (with a freshly-read
// SyncToken); unlinked → create one and backfill its `Id`. On success, redirects
// back to the dealer page with `?qbpush=created|updated` so it flashes a notice
// and re-renders the new link state. Errors (not connected / token refresh /
// QBO write, incl. a duplicate-name 6240) PROPAGATE to Next's error boundary —
// same rationale as `syncDealersFromQuickbooks`: the button only renders once
// the page sees a live connection, and a caught-and-redirected error would read
// as a wrong gate-admit to the action-gate-matrix suite.
export async function pushDealerToQuickbooks(formData: FormData) {
  const user = await assertCan('admin:access');
  const { dealerId } = pushDealerSchema.parse({ dealerId: formData.get('dealerId') });

  const dealer = await loadDealer(dealerId);
  if (!dealer) throw new Error(`Dealer ${dealerId} not found.`);

  const { realmId, accessToken } = await getValidAccessToken();
  const result = await pushDealerToQbo(dealer, realmId, accessToken, user.id);

  revalidatePath(`/dealerships/${dealerId}`);
  redirect(`/dealerships/${dealerId}?qbpush=${result.action}`);
}
