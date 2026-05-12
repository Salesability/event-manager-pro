import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { audienceSources } from './audience-sources';
import { dealers } from './dealers';
import { masterServiceAgreements } from './master-service-agreements';

// Quote = the accepted contract per Salesability MSA §1.iii ("Each Quote …
// shall constitute a separate distinct and independent agreement"). The
// `quotes` row is the source of truth for the commercial deal; `campaigns`
// holds the operational delivery (FK runs `campaigns.acceptedQuoteId` →
// `quotes.id`, populated when an accepted quote spawns a delivery campaign).
//
// `inputs` is the typed `QuoteInputs` snapshot the composer writes (audience
// size, event days, per-channel counts, etc.). `lineItems` is the computed
// output snapshot derived from `inputs` × the service-items catalog at
// edit/send time. Both columns are jsonb in v1; normalization into a
// `quote_line_items` table is deferred to 7.3 if invoicing needs per-line
// reporting (see 0026 Open Questions).
//
// `id` uses `bigIdentity()` not uuid (deviates from the plan body's "id (uuid)"
// wording): repo convention defaults to bigint for domain tables (`campaigns`,
// `dealers`, `master_service_agreements`), the Code Anchor `campaigns.ts` uses
// bigint, and the unguessable-public-URL slot is already served by
// `acceptToken` (uuid). Saves storage + B-tree locality.

export const quoteStatus = pgEnum('quote_status', [
  'draft',
  'sent',
  'accepted',
  'declined',
]);

export const quotes = pgTable(
  'quotes',
  {
    id: bigIdentity(),
    dealerId: bigint('dealer_id', { mode: 'number' })
      .notNull()
      .references(() => dealers.id, { onDelete: 'restrict' }),
    msaId: bigint('msa_id', { mode: 'number' }).references(
      () => masterServiceAgreements.id,
      { onDelete: 'restrict' }
    ),
    status: quoteStatus('status').notNull().default('draft'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    acceptToken: uuid('accept_token').notNull().unique().default(sql`gen_random_uuid()`),
    pdfStorageKey: text('pdf_storage_key'),
    sentToEmail: text('sent_to_email'),
    sentToFirstName: text('sent_to_first_name'),
    inputs: jsonb('inputs').notNull(),
    fee: numeric('fee', { precision: 10, scale: 2 }).notNull().default('0'),
    travel: numeric('travel', { precision: 10, scale: 2 }).notNull().default('0'),
    depositPct: numeric('deposit_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    taxPct: numeric('tax_pct', { precision: 5, scale: 2 }).notNull().default('15'),
    quoteValidDays: integer('quote_valid_days').notNull().default(30),
    audienceSourceId: bigint('audience_source_id', { mode: 'number' }).references(
      () => audienceSources.id
    ),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    tax: numeric('tax', { precision: 12, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
    lineItems: jsonb('line_items').notNull().default(sql`'[]'::jsonb`),
    previousQuoteId: bigint('previous_quote_id', { mode: 'number' }).references(
      (): AnyPgColumn => quotes.id,
      { onDelete: 'set null' }
    ),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('quotes_dealer_id_idx').on(table.dealerId),
    index('quotes_dealer_id_status_idx').on(table.dealerId, table.status),
    index('quotes_msa_id_idx').on(table.msaId),
    index('quotes_audience_source_id_idx').on(table.audienceSourceId),
    index('quotes_previous_quote_id_idx').on(table.previousQuoteId),
    index('quotes_created_by_id_idx').on(table.createdById),
    index('quotes_updated_by_id_idx').on(table.updatedById),
    check(
      'quotes_deposit_pct_range',
      sql`${table.depositPct} >= 0 AND ${table.depositPct} <= 100`
    ),
    check(
      'quotes_tax_pct_range',
      sql`${table.taxPct} >= 0 AND ${table.taxPct} <= 100`
    ),
    check('quotes_quote_valid_days_positive', sql`${table.quoteValidDays} > 0`),
  ]
);
