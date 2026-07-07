import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  audienceSources,
  auditLog,
  campaigns,
  dealers,
  quoteAttachments,
  quoteLineItems,
  quotes,
  serviceItems,
  taxRates,
} from '@/lib/db/schema';
import type { PickedLine, QuoteInputs } from '@/lib/quotes/pricing';
import type { QuoteAttachmentView } from './attachments';
import type { CaProvinceCode } from '@/lib/ca-provinces';

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
  /** Snapshot of the dealer's province sales-tax rate applied (percent). */
  taxPct: string;
  /** Coach's manual tax override, or null when tax is auto (0065). */
  taxOverride: string | null;
  /** The dealer's province (for the tax label), or null. */
  province: CaProvinceCode | null;
  inputs: QuoteInputs;
  /** 0062 — the SKU picker's line rows, from `quote_line_items` ordered by
   *  `display_order`. Populated only by `loadQuote` (the composer path); list
   *  loaders leave it `[]` to avoid an N+1 (the list views show totals, not
   *  lines). */
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
  /** QBO `Estimate.Id` this quote was pushed to (0073), or null if never pushed. */
  quickbooksEstimateId: string | null;
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
  taxOverride: quotes.taxOverride,
  province: dealers.province,
  inputs: quotes.inputs,
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
  quickbooksEstimateId: quotes.quickbooksEstimateId,
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
  taxOverride: string | null;
  province: CaProvinceCode | null;
  inputs: unknown;
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
  quickbooksEstimateId: string | null;
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
    taxOverride: row.taxOverride,
    province: row.province,
    inputs: row.inputs as QuoteInputs,
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
    quickbooksEstimateId: row.quickbooksEstimateId,
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

// The picker's lines for one quote: the `quote_line_items` rows ordered by
// `display_order`.
async function loadPickedLines(quoteId: number): Promise<PickedLine[]> {
  const rows = (await db
    .select(lineItemProjection)
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quoteId))
    .orderBy(asc(quoteLineItems.displayOrder))) as LineItemRow[];
  return rows.map(mapLineRow);
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
  const pickedLines = await loadPickedLines(id);
  return { ...quote, pickedLines };
}

// 0100: whether the quote's linked event opts out of the MSA
// (`campaigns.msa_waived`). Mirrors the `acceptQuote` gate for the staff
// "Mark accepted" control. An `innerJoin` means a quote with no campaign link
// (null `campaignId`) yields no row → `false`: no event, no waiver to inherit,
// so the normal active-MSA requirement stands.
export async function loadQuoteEventMsaWaived(quoteId: number): Promise<boolean> {
  const [row] = await db
    .select({ msaWaived: campaigns.msaWaived })
    .from(quotes)
    .innerJoin(campaigns, eq(campaigns.id, quotes.campaignId))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  return row?.msaWaived ?? false;
}

// Assembled data for the QBO Estimate push (0073): the quote's push-relevant
// fields, the dealer's QBO link, and each line with its SKU's QBO link
// (left-joined `service_items.quickbooks_id`, null when the SKU is unlinked or
// the line's `service_item_id` is null). Shapes match `quote-push.ts`'s
// `QuotePush{Quote,Dealer,Line}`; the Server Action passes them to the core.
export type QuoteEstimatePushData = {
  quote: {
    id: number;
    status: QuoteStatus;
    subtotal: string;
    tax: string;
    quickbooksEstimateId: string | null;
    // QBO tax code for the dealer's province (0074), or null when unmapped.
    taxCodeId: string | null;
    // The province's current rate (%) — equals the matched code's rate; used for
    // the push's rate-drift guard. Null when the province has no `tax_rates` row.
    provinceRatePct: string | null;
    taxOverride: string | null;
  };
  dealer: { id: number; name: string; quickbooksId: string | null };
  lines: {
    code: string;
    label: string;
    qty: number;
    unitPrice: string;
    overrideUnitPrice: string | null;
    lineTotal: string;
    itemQuickbooksId: string | null;
  }[];
};

export async function loadQuoteEstimatePushData(
  quoteId: number,
): Promise<QuoteEstimatePushData | null> {
  const [q] = await db
    .select({
      id: quotes.id,
      status: quotes.status,
      subtotal: quotes.subtotal,
      tax: quotes.tax,
      taxOverride: quotes.taxOverride,
      quickbooksEstimateId: quotes.quickbooksEstimateId,
      dealerId: dealers.id,
      dealerName: dealers.name,
      dealerQuickbooksId: dealers.quickbooksId,
      // QBO tax code for the dealer's province (0074), via the province→code map.
      taxCodeId: taxRates.quickbooksTaxCodeId,
      provinceRatePct: taxRates.rate,
    })
    .from(quotes)
    .innerJoin(dealers, eq(dealers.id, quotes.dealerId))
    .leftJoin(taxRates, eq(taxRates.province, dealers.province))
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!q) return null;

  const lines = await db
    .select({
      code: quoteLineItems.code,
      label: quoteLineItems.label,
      qty: quoteLineItems.qty,
      unitPrice: quoteLineItems.unitPrice,
      overrideUnitPrice: quoteLineItems.overrideUnitPrice,
      lineTotal: quoteLineItems.lineTotal,
      itemQuickbooksId: serviceItems.quickbooksId,
    })
    .from(quoteLineItems)
    .leftJoin(serviceItems, eq(serviceItems.id, quoteLineItems.serviceItemId))
    .where(eq(quoteLineItems.quoteId, quoteId))
    .orderBy(asc(quoteLineItems.displayOrder));

  return {
    quote: {
      id: q.id,
      status: q.status,
      subtotal: q.subtotal,
      tax: q.tax,
      quickbooksEstimateId: q.quickbooksEstimateId,
      taxCodeId: q.taxCodeId,
      provinceRatePct: q.provinceRatePct,
      taxOverride: q.taxOverride,
    },
    dealer: { id: q.dealerId, name: q.dealerName, quickbooksId: q.dealerQuickbooksId },
    lines,
  };
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

// Lists a quote's uploaded attachments for the send dialog (0078), ordered by
// the stored `displayOrder` then id. Returns the display slice only — the
// `storageKey` stays server-side (the send action resolves bytes from it).
export async function loadQuoteAttachments(
  quoteId: number,
): Promise<QuoteAttachmentView[]> {
  return db
    .select({
      id: quoteAttachments.id,
      filename: quoteAttachments.filename,
      contentType: quoteAttachments.contentType,
      byteSize: quoteAttachments.byteSize,
    })
    .from(quoteAttachments)
    .where(eq(quoteAttachments.quoteId, quoteId))
    .orderBy(asc(quoteAttachments.displayOrder), asc(quoteAttachments.id));
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
