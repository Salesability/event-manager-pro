import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audienceSources, auditLog, dealers, quotes } from '@/lib/db/schema';
import type { ComputedLine, QuoteInputs } from '@/lib/quotes/pricing';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined';

// Read-model for the `/quotes` index, `/quotes/[id]` edit page, and
// `/dealerships/[id]` quote-history section. Mirrors the shape of `Campaign`
// in `src/features/schedule/queries.ts:45` — projection-first, joined dealer
// + (optional) audience-source label flattened onto the row. `inputs` is the
// composer-hydration jsonb snapshot; everything else feeds the list table or
// the read-only edit-mode banner.
export type Quote = {
  id: number;
  dealerId: number;
  dealerName: string;
  dealerArchivedAt: Date | null;
  status: QuoteStatus;
  subtotal: string;
  tax: string;
  total: string;
  taxPct: string;
  inputs: QuoteInputs;
  lineItems: ComputedLine[];
  audienceSourceId: number | null;
  audienceSourceLabel: string | null;
  sentAt: Date | null;
  sentToEmail: string | null;
  sentToFirstName: string | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  pdfStorageKey: string | null;
  createdAt: Date;
  createdById: string | null;
};

const projection = {
  id: quotes.id,
  dealerId: quotes.dealerId,
  dealerName: dealers.name,
  dealerArchivedAt: dealers.archivedAt,
  status: quotes.status,
  subtotal: quotes.subtotal,
  tax: quotes.tax,
  total: quotes.total,
  taxPct: quotes.taxPct,
  inputs: quotes.inputs,
  lineItems: quotes.lineItems,
  audienceSourceId: quotes.audienceSourceId,
  audienceSourceLabel: audienceSources.label,
  sentAt: quotes.sentAt,
  sentToEmail: quotes.sentToEmail,
  sentToFirstName: quotes.sentToFirstName,
  acceptedAt: quotes.acceptedAt,
  declinedAt: quotes.declinedAt,
  pdfStorageKey: quotes.pdfStorageKey,
  createdAt: quotes.createdAt,
  createdById: quotes.createdById,
};

type QuoteRow = {
  id: number;
  dealerId: number;
  dealerName: string;
  dealerArchivedAt: Date | null;
  status: QuoteStatus;
  subtotal: string;
  tax: string;
  total: string;
  taxPct: string;
  inputs: unknown;
  lineItems: unknown;
  audienceSourceId: number | null;
  audienceSourceLabel: string | null;
  sentAt: Date | null;
  sentToEmail: string | null;
  sentToFirstName: string | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  pdfStorageKey: string | null;
  createdAt: Date;
  createdById: string | null;
};

function mapRow(row: QuoteRow): Quote {
  return {
    id: row.id,
    dealerId: row.dealerId,
    dealerName: row.dealerName,
    dealerArchivedAt: row.dealerArchivedAt,
    status: row.status,
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    taxPct: row.taxPct,
    inputs: row.inputs as QuoteInputs,
    lineItems: row.lineItems as unknown as ComputedLine[],
    audienceSourceId: row.audienceSourceId,
    audienceSourceLabel: row.audienceSourceLabel,
    sentAt: row.sentAt,
    sentToEmail: row.sentToEmail,
    sentToFirstName: row.sentToFirstName,
    acceptedAt: row.acceptedAt,
    declinedAt: row.declinedAt,
    pdfStorageKey: row.pdfStorageKey,
    createdAt: row.createdAt,
    createdById: row.createdById,
  };
}

export async function loadQuotes(): Promise<Quote[]> {
  const rows = await db
    .select(projection)
    .from(quotes)
    .innerJoin(dealers, eq(dealers.id, quotes.dealerId))
    .leftJoin(audienceSources, eq(audienceSources.id, quotes.audienceSourceId))
    .orderBy(desc(quotes.createdAt));
  return rows.map(mapRow);
}

export async function loadQuote(id: number): Promise<Quote | null> {
  const [row] = await db
    .select(projection)
    .from(quotes)
    .innerJoin(dealers, eq(dealers.id, quotes.dealerId))
    .leftJoin(audienceSources, eq(audienceSources.id, quotes.audienceSourceId))
    .where(eq(quotes.id, id))
    .limit(1);
  return row ? mapRow(row) : null;
}

export type QuoteSendReceipt = {
  occurredAt: Date;
  actorUserId: string | null;
  payload: unknown;
};

// Reads the `quote.sent` audit row for a quote — the source of truth for the
// Resend message ID (`payload.emailId`) and the actor who fired send. Phase 4
// renders the send-receipt panel off this + the row-level denorm on `quotes`.
// Returns `null` when the quote was never sent (no audit row); `payload` stays
// `unknown` here so callers cast/validate at the UI boundary.
export async function loadQuoteSendReceipt(
  quoteId: number,
): Promise<QuoteSendReceipt | null> {
  const [row] = await db
    .select({
      occurredAt: auditLog.occurredAt,
      actorUserId: auditLog.actorUserId,
      payload: auditLog.payload,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.targetTable, 'quotes'),
        eq(auditLog.targetId, quoteId),
        eq(auditLog.action, 'quote.sent'),
      ),
    )
    .orderBy(desc(auditLog.occurredAt))
    .limit(1);
  return row ?? null;
}

export async function loadQuotesByDealer(dealerId: number): Promise<Quote[]> {
  const rows = await db
    .select(projection)
    .from(quotes)
    .innerJoin(dealers, eq(dealers.id, quotes.dealerId))
    .leftJoin(audienceSources, eq(audienceSources.id, quotes.audienceSourceId))
    .where(eq(quotes.dealerId, dealerId))
    .orderBy(desc(quotes.createdAt));
  return rows.map(mapRow);
}
