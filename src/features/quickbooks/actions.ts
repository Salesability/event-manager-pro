'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertCan } from '@/lib/auth/assert-can';
import { db } from '@/lib/db';
import {
  QBO_STATE_COOKIE,
  buildAuthorizeUrl,
  fetchCustomers,
  fetchItems,
  quickbooksRedirectUri,
  revokeToken,
} from '@/lib/quickbooks/client';
import { deleteConnection, getConnection, getValidAccessToken } from '@/lib/quickbooks/connection';
import { pushDealerToQuickbooks as pushDealerToQbo } from '@/lib/quickbooks/dealer-push';
import { applyDealerSync, type SyncSummary } from '@/lib/quickbooks/dealer-sync';
import { applyItemSync, type ItemSyncSummary } from '@/lib/quickbooks/item-sync';
import { encodeQbSyncSummary } from '@/lib/quickbooks/qb-sync-summary';
import {
  QuotePushNotReadyError,
  pushQuoteToQuickbooks as pushQuoteToEstimate,
} from '@/lib/quickbooks/quote-push';
import { loadDealer } from '@/features/schedule/queries';
import { loadQuoteEstimatePushData } from '@/features/quotes/queries';

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
// validation: skip — no FormData input; reads the live QB customer + item lists
// and applies both computed change sets in one click (chunk 0083).
//
// Unified "Sync" for /admin/quickbooks: one click reconciles dealers (QBO→app
// create/link, never clobbering app-authored data — chunk 0069) AND mirrors the
// item catalog from QuickBooks (create / update / archive / purge — chunk 0071),
// then flashes ONE combined summary. The two passes run INDEPENDENTLY (each in
// its own try/catch): a throw in one must never discard the other's already-
// committed result — that's the honest report, since the successful pass's
// writes are real. The shared token fetch stays OUTSIDE the per-pass guards so a
// not-connected / token-refresh failure PROPAGATES to Next's error boundary
// (same gate-matrix rationale as `syncDealersFromQuickbooks`); only the per-pass
// fetch+apply is caught and surfaced as `?qbderror=`/`?qbierror=`.
export async function syncQuickbooks() {
  const user = await assertCan('admin:access');

  const { realmId, accessToken } = await getValidAccessToken();

  let dealers: SyncSummary = { created: 0, linked: 0, skipped: 0 };
  let dealerError: string | null = null;
  try {
    const customers = await fetchCustomers(realmId, accessToken);
    dealers = await applyDealerSync(customers, user.id);
  } catch (err) {
    dealerError = err instanceof Error ? err.message : 'Could not sync dealers from QuickBooks.';
  }

  let items: ItemSyncSummary = { created: 0, updated: 0, archived: 0, purged: 0 };
  let itemError: string | null = null;
  try {
    const qbItems = await fetchItems(realmId, accessToken);
    items = await db.transaction((tx) => applyItemSync(qbItems, tx));
  } catch (err) {
    itemError = err instanceof Error ? err.message : 'Could not sync items from QuickBooks.';
  }

  revalidatePath('/admin/quickbooks');
  const params = new URLSearchParams({ qbsync: encodeQbSyncSummary(dealers, items) });
  if (dealerError) params.set('qbderror', dealerError);
  if (itemError) params.set('qbierror', itemError);
  redirect(`/admin/quickbooks?${params.toString()}`);
}

// Tax-code sync RETIRED (0076): the auto-apply "Pull tax codes" heuristic could
// mis-map provinces (e.g. NS's stale 15% code) and clobber the mapping. Province
// → QB-tax-code mapping is now explicit on /admin/lookups (`assignProvinceTaxCode`)
// + a rate-only `refreshTaxRates`; see `src/features/tax-rates/`.

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
  const parsed = pushDealerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error('Push to QuickBooks requires a valid dealerId.');
  const { dealerId } = parsed.data;

  const dealer = await loadDealer(dealerId);
  if (!dealer) throw new Error(`Dealer ${dealerId} not found.`);

  const { realmId, accessToken } = await getValidAccessToken();
  const result = await pushDealerToQbo(dealer, realmId, accessToken, user.id);

  revalidatePath(`/dealerships/${dealerId}`);
  redirect(`/dealerships/${dealerId}?qbpush=${result.action}`);
}

const pushQuoteSchema = z.object({
  quoteId: z.coerce.number().int().positive(),
});

const PUSHABLE_QUOTE_STATUSES = new Set(['accepted', 'sent']);

// authz: admin:access
// validation: Zod — `quoteId` (positive int) from the quote-page form.
//
// Push a quote → QBO Estimate (chunk 0073 — Slice 3): linked quote → update the
// Estimate (freshly-read SyncToken); unlinked → create one + backfill the `Id`.
// A not-pushable status or a pre-flight failure (dealer / any line SKU not
// QBO-linked → `QuotePushNotReadyError`) redirects to `?qberror=<msg>` — these
// are user-actionable states, unlike connection/transport errors which propagate
// (same gate-matrix rationale as the other QBO actions). Success →
// `?qbpush=created|updated`.
export async function pushQuoteToQuickbooks(formData: FormData) {
  await assertCan('admin:access');
  const parsed = pushQuoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error('Push to QuickBooks requires a valid quoteId.');
  const { quoteId } = parsed.data;

  const data = await loadQuoteEstimatePushData(quoteId);
  if (!data) throw new Error(`Quote ${quoteId} not found.`);

  if (!PUSHABLE_QUOTE_STATUSES.has(data.quote.status)) {
    redirect(
      `/quotes/${quoteId}?qberror=${encodeURIComponent('Only sent or accepted quotes can be pushed to QuickBooks.')}`,
    );
  }

  const { realmId, accessToken } = await getValidAccessToken();
  let result;
  try {
    result = await pushQuoteToEstimate(data.quote, data.lines, data.dealer, realmId, accessToken);
  } catch (err) {
    if (err instanceof QuotePushNotReadyError) {
      redirect(`/quotes/${quoteId}?qberror=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  revalidatePath(`/quotes/${quoteId}`);
  redirect(`/quotes/${quoteId}?qbpush=${result.action}`);
}
