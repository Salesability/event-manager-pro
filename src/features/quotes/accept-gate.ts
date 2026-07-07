import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campaigns, masterServiceAgreements } from '@/lib/db/schema';

// Accept either the app pool or a transaction so the integration test can drive
// the check inside a rolled-back tx (cf. campaign-delivery.ts). `acceptQuote`
// calls with the default (the app pool).
type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// 0082 + 0100: the MSA precondition for accepting a `sent` quote.
//
// 0082 D3: a quote can only be accepted once the dealer has a LIVE active MSA
// (the accepted quote IS the contract; the master agreement is signed first).
// "Live" = `status='active'` AND `expires_at >= now()` (Postgres-time, like the
// quote-expiry guard) — the daily active→expired sweep isn't built, so an
// expired-but-still-`active` row must not read as protected, and a null
// `expires_at` fails the comparison → blocked.
//
// 0100: a per-event waiver (`campaigns.msa_waived`) opts the event's quote out
// of that requirement entirely — the coach has decided this event doesn't need
// an MSA. A quote with no campaign link (null `campaignId`) has no event-level
// waiver to inherit, so the normal active-MSA requirement stands.
//
// Returns true when acceptance is allowed on the MSA dimension.
export async function isAcceptMsaSatisfied(
  dealerId: number,
  campaignId: number | null,
  exec: Executor = db,
): Promise<boolean> {
  if (campaignId != null) {
    const [campaign] = await exec
      .select({ msaWaived: campaigns.msaWaived })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (campaign?.msaWaived) return true;
  }

  const [activeMsa] = await exec
    .select({ id: masterServiceAgreements.id })
    .from(masterServiceAgreements)
    .where(
      and(
        eq(masterServiceAgreements.dealerId, dealerId),
        eq(masterServiceAgreements.status, 'active'),
        sql`${masterServiceAgreements.expiresAt} >= now()`,
      ),
    )
    .limit(1);
  return Boolean(activeMsa);
}
