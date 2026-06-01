import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { audienceSources, auditLog, dealers, quoteLineItems, quotes } from '@/lib/db/schema';
import type { ComputedLine, PickedLine, QuoteInputs } from '@/lib/quotes/pricing';

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
  /** @deprecated 0062 — legacy JSONB line snapshot. Read from `pickedLines`
   *  instead; this field is sourced from `quotes.line_items`, dropped in
   *  Phase 6. Populated only on the single-quote load path. */
  lineItems: ComputedLine[];
  /** 0062 — the SKU picker's line rows, from `quote_line_items` ordered by
   *  `display_order`. Populated only by `loadQuote` (the composer path); list
   *  loaders leave it `[]` to avoid an N+1 (the list views show totals, not
   *  lines). Falls back to JSONB-derived lines while the table is empty
   *  mid-cutover (Phase 3 safety net, removed in Phase 6). */
  pickedLines: PickedLine[];
  audienceSourceId: number | null;
  audienceSourceLabel: string | null;
  sentAt: Date | null;
  sentToEmail: string | null;
  sentToFirstName: string | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  pdfStorageKey: string | null;
  /** Per-row validity window in days (default 30, schema NOT NULL). */
  quoteValidDays: number;
  /**
   * Derived at read time: `status === 'sent' && sentAt + quoteValidDays < now()`.
   * Underlying row stays `status='sent'` — this is a presentational projection
   * (Option B from 0044 plan OQ #1). UI flips the status pill to "Expired"
   * when true, but the row is still a sent quote.
   */
  isExpired: boolean;
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
  quoteValidDays: quotes.quoteValidDays,
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
  quoteValidDays: number;
  createdAt: Date;
  createdById: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function mapRow(row: QuoteRow): Quote {
  const isExpired =
    row.status === 'sent' &&
    row.sentAt != null &&
    row.sentAt.getTime() + row.quoteValidDays * MS_PER_DAY < Date.now();
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
    // List loaders leave this empty; `loadQuote` populates it from the table.
    pickedLines: [],
    audienceSourceId: row.audienceSourceId,
    audienceSourceLabel: row.audienceSourceLabel,
    sentAt: row.sentAt,
    sentToEmail: row.sentToEmail,
    sentToFirstName: row.sentToFirstName,
    acceptedAt: row.acceptedAt,
    declinedAt: row.declinedAt,
    pdfStorageKey: row.pdfStorageKey,
    quoteValidDays: row.quoteValidDays,
    isExpired,
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

const lineItemProjection = {
  serviceItemId: quoteLineItems.serviceItemId,
  code: quoteLineItems.code,
  label: quoteLineItems.label,
  description: quoteLineItems.description,
  qty: quoteLineItems.qty,
  unitPrice: quoteLineItems.unitPrice,
  overrideUnitPrice: quoteLineItems.overrideUnitPrice,
  lineTotal: quoteLineItems.lineTotal,
};

type LineItemRow = {
  serviceItemId: number | null;
  code: string;
  label: string;
  description: string | null;
  qty: number;
  unitPrice: string;
  overrideUnitPrice: string | null;
  lineTotal: string;
};

function mapLineRow(row: LineItemRow): PickedLine {
  return {
    serviceItemId: row.serviceItemId ?? undefined,
    code: row.code,
    label: row.label,
    description: row.description ?? undefined,
    qty: row.qty,
    unitPrice: Number(row.unitPrice),
    overrideUnitPrice: row.overrideUnitPrice != null ? Number(row.overrideUnitPrice) : undefined,
    lineTotal: Number(row.lineTotal),
  };
}

// Phase 3 safety net (removed in Phase 6): project a legacy JSONB `ComputedLine`
// onto the `PickedLine` shape so a quote whose `quote_line_items` rows haven't
// landed yet (pre-backfill / mid-cutover) still rehydrates the composer. Old
// JSONB lines carry no `serviceItemId`/`description`.
function computedLineToPicked(line: ComputedLine): PickedLine {
  return {
    code: line.code,
    label: line.label,
    qty: line.qty,
    unitPrice: line.unitPrice,
    overrideUnitPrice: line.overrideUnitPrice,
    lineTotal: line.lineTotal,
  };
}

// The picker's lines for one quote: the `quote_line_items` rows ordered by
// `display_order`, with the JSONB fallback while the table is empty.
async function loadPickedLines(
  quoteId: number,
  jsonbFallback: ComputedLine[],
): Promise<PickedLine[]> {
  const rows = (await db
    .select(lineItemProjection)
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quoteId))
    .orderBy(asc(quoteLineItems.displayOrder))) as LineItemRow[];
  if (rows.length > 0) return rows.map(mapLineRow);
  return jsonbFallback.map(computedLineToPicked);
}

export async function loadQuote(id: number): Promise<Quote | null> {
  const [row] = await db
    .select(projection)
    .from(quotes)
    .innerJoin(dealers, eq(dealers.id, quotes.dealerId))
    .leftJoin(audienceSources, eq(audienceSources.id, quotes.audienceSourceId))
    .where(eq(quotes.id, id))
    .limit(1);
  if (!row) return null;
  const quote = mapRow(row);
  const pickedLines = await loadPickedLines(id, quote.lineItems);
  return { ...quote, pickedLines };
}

export type QuoteSendReceipt = {
  occurredAt: Date;
  actorUserId: string | null;
  payload: unknown;
};

// Reads every `quote.sent` audit row for a quote — Send history. Each row
// carries the Resend message ID (`payload.emailId`) and the actor who fired
// the send. 0046 flipped this from single-row to multi-row: each re-send
// emits a fresh `quote.sent` audit row, so the chronology naturally falls
// out of `.orderBy(desc(auditLog.occurredAt))`. The most-recent send is
// `[0]`; the quote-detail page surfaces "Download PDF" only on it (the
// `pdfStorageKey` overwrites in place, so older sends point at the current
// object — recipients keep their own emailed PDFs).
// Returns `[]` when the quote was never sent. `payload` stays `unknown`
// here so callers cast/validate at the UI boundary.
export async function loadQuoteSendHistory(
  quoteId: number,
): Promise<QuoteSendReceipt[]> {
  return db
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
    .orderBy(desc(auditLog.occurredAt));
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
