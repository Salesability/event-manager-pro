import { and, eq, isNull } from 'drizzle-orm';
import type { CaProvinceCode } from '@/lib/ca-provinces';
import { db } from '@/lib/db';
import { dealers } from '@/lib/db/schema';
import {
  type QboCustomerInput,
  createCustomer,
  fetchCustomerById,
  updateCustomer,
} from '@/lib/quickbooks/client';

// Push a `dealers` row TO QuickBooks as a Customer (chunk 0070) — the app→QBO
// counterpart of `dealer-sync.ts`'s QBO→app pull. Linked dealer (`quickbooks_id`
// set) → UPDATE the existing Customer; unlinked → CREATE one and backfill the
// returned `Id` onto the dealer. On-demand only (an explicit "Push to
// QuickBooks" button), never a side effect of `createDealer`/`updateDealer`.
//
// `mapDealerToCustomer` is the INVERSE of `dealer-sync.ts:mapCustomerToDealer`.
// Address fidelity is intentionally lossy: our `dealers.address` is a single
// flat string (0069's `formatAddress` joined the QBO parts), so we send the
// whole blob as `BillAddr.Line1` rather than re-parsing it into structured
// QBO address fields. Email/phone come from the dealer's primary contact
// (`dealers` itself has no contact columns).

// `db` and a transaction handle both satisfy the update surface — accepting
// either lets the integration test pass a rolled-back tx (mirrors dealer-sync).
type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// The fields the push needs — a structural subset of `loadDealer`'s `Dealer`
// (plus `quickbooksId`, which Phase 3 adds to that projection).
export type DealerToPush = {
  id: number;
  name: string;
  address: string | null;
  province: CaProvinceCode | null;
  quickbooksId: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
};

// dealer → QBO Customer write payload (inverse of `mapCustomerToDealer`).
export function mapDealerToCustomer(dealer: DealerToPush): QboCustomerInput {
  const input: QboCustomerInput = {
    DisplayName: dealer.name,
    CompanyName: dealer.name,
  };
  if (dealer.contactFirstName) input.GivenName = dealer.contactFirstName;
  if (dealer.contactLastName) input.FamilyName = dealer.contactLastName;
  if (dealer.address || dealer.province) {
    input.BillAddr = {
      ...(dealer.address ? { Line1: dealer.address } : {}),
      ...(dealer.province ? { CountrySubDivisionCode: dealer.province } : {}),
    };
  }
  if (dealer.primaryEmail) input.PrimaryEmailAddr = { Address: dealer.primaryEmail };
  if (dealer.primaryPhone) input.PrimaryPhone = { FreeFormNumber: dealer.primaryPhone };
  return input;
}

// Pure: which write a push will perform. Linked → update, unlinked → create.
export function planDealerPush(dealer: Pick<DealerToPush, 'quickbooksId'>): 'create' | 'update' {
  return dealer.quickbooksId ? 'update' : 'create';
}

export type PushResult = { action: 'created' | 'updated'; qbId: string };

// Push one dealer to QBO. Update path reads the Customer first for a fresh
// `SyncToken` (read-before-write — QBO rotates it on every edit, including ones
// made in the QBO UI). Create path inserts a Customer then backfills its `Id`
// onto the dealer via a guarded UPDATE (`WHERE id=? AND quickbooks_id IS NULL`,
// mirroring `applyDealerSync`'s link write) so a concurrent push can't clobber
// an existing link.
export async function pushDealerToQuickbooks(
  dealer: DealerToPush,
  realmId: string,
  accessToken: string,
  actorId: string | null,
  exec: Executor = db,
): Promise<PushResult> {
  const payload = mapDealerToCustomer(dealer);

  if (dealer.quickbooksId) {
    const current = await fetchCustomerById(realmId, accessToken, dealer.quickbooksId);
    await updateCustomer(realmId, accessToken, {
      ...payload,
      Id: dealer.quickbooksId,
      SyncToken: current.SyncToken ?? '0',
    });
    await exec.update(dealers).set({ updatedById: actorId }).where(eq(dealers.id, dealer.id));
    return { action: 'updated', qbId: dealer.quickbooksId };
  }

  const created = await createCustomer(realmId, accessToken, payload);
  // Guarded backfill — a concurrent push that already linked this dealer leaves
  // zero rows updated; we don't clobber it (the freshly-created QBO Customer is
  // an accepted, rare duplicate in that race).
  await exec
    .update(dealers)
    .set({ quickbooksId: created.Id, updatedById: actorId })
    .where(and(eq(dealers.id, dealer.id), isNull(dealers.quickbooksId)))
    .returning({ id: dealers.id });
  return { action: 'created', qbId: created.Id };
}
