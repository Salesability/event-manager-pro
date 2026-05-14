import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { masterServiceAgreements, quotes } from '@/lib/db/schema';

export type MsaStatus = 'pending' | 'active' | 'expired' | 'terminated';

// Read-model for the `/dealerships/[id]` MSA panel and the upcoming Phase 7.2
// MSA reporting surfaces. Projection-first to match the shape conventions in
// `features/quotes/queries.ts`; `signedAt`/`expiresAt`/`signedPdfStorageKey`
// are nullable until the row reaches `active`.
export type Msa = {
  id: number;
  dealerId: number;
  status: MsaStatus;
  signedAt: Date | null;
  expiresAt: Date | null;
  signedPdfStorageKey: string | null;
  dropboxSignDocumentId: string | null;
  terminationNoticeDate: Date | null;
  terminationEffectiveDate: Date | null;
  templateVersion: string;
  createdAt: Date;
};

const projection = {
  id: masterServiceAgreements.id,
  dealerId: masterServiceAgreements.dealerId,
  status: masterServiceAgreements.status,
  signedAt: masterServiceAgreements.signedAt,
  expiresAt: masterServiceAgreements.expiresAt,
  signedPdfStorageKey: masterServiceAgreements.signedPdfStorageKey,
  dropboxSignDocumentId: masterServiceAgreements.dropboxSignDocumentId,
  terminationNoticeDate: masterServiceAgreements.terminationNoticeDate,
  terminationEffectiveDate: masterServiceAgreements.terminationEffectiveDate,
  templateVersion: masterServiceAgreements.templateVersion,
  createdAt: masterServiceAgreements.createdAt,
};

export async function loadMsasByDealer(dealerId: number): Promise<Msa[]> {
  const rows = await db
    .select(projection)
    .from(masterServiceAgreements)
    .where(eq(masterServiceAgreements.dealerId, dealerId))
    .orderBy(desc(masterServiceAgreements.createdAt));
  return rows;
}

// Returns the single 'active' MSA for a dealer (the v1 cardinality is one
// active per dealer per the project_msa_structure memory). Falls back to the
// most-recent pending row when there is no active — useful for the panel's
// "pending signature" rendering. Returns null when there is no MSA at all.
export async function loadActiveOrPendingMsa(
  dealerId: number,
): Promise<Msa | null> {
  // Two-step: active first; if missing, fall back to pending. Cheap because
  // (dealer_id, status) is indexed on this table.
  const [active] = await db
    .select(projection)
    .from(masterServiceAgreements)
    .where(
      and(
        eq(masterServiceAgreements.dealerId, dealerId),
        eq(masterServiceAgreements.status, 'active'),
      ),
    )
    .limit(1);
  if (active) return active;

  const [pending] = await db
    .select(projection)
    .from(masterServiceAgreements)
    .where(
      and(
        eq(masterServiceAgreements.dealerId, dealerId),
        eq(masterServiceAgreements.status, 'pending'),
      ),
    )
    .orderBy(desc(masterServiceAgreements.createdAt))
    .limit(1);
  return pending ?? null;
}

// Returns the dealer's first draft Quote (id + createdAt) so the Phase 5 MSA
// panel can decide whether to enable the "Create MSA + send" button (requires
// a draft Quote in the envelope per the bundled-send v1 contract). `createdAt`
// drives the `quote-<timestamp>` display name in the create-MSA dialog.
export async function firstDraftQuoteForDealer(
  dealerId: number,
): Promise<{ id: number; createdAt: Date } | null> {
  const [row] = await db
    .select({ id: quotes.id, createdAt: quotes.createdAt })
    .from(quotes)
    .where(and(eq(quotes.dealerId, dealerId), eq(quotes.status, 'draft')))
    .orderBy(quotes.id)
    .limit(1);
  return row ?? null;
}
