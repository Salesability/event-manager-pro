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
  uniqueIndex,
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
// `inputs` is a jsonb bag the composer writes — since 0062 the picker only
// stores `quoteNotes` here (the audience/days/per-channel fields linger for the
// production/reports/calendar readers but are no longer composer-driven). The
// quote's line items live in the `quote_line_items` table (0062, one row per
// picked SKU); the former `line_items` jsonb column was dropped in 0062 Phase 7
// (migration 0025) once the composer, read path, and PDF renderer all read the
// table.
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
    // 0065: snapshot of the dealer's province sales-tax rate applied to this
    // quote (percent). Widened 5,2 → 6,3 so QC's 14.975 fits. Default 0 (was a
    // dead 15) — the real value is derived from the dealer's province at
    // create/edit time.
    taxPct: numeric('tax_pct', { precision: 6, scale: 3 }).notNull().default('0'),
    quoteValidDays: integer('quote_valid_days').notNull().default(30),
    audienceSourceId: bigint('audience_source_id', { mode: 'number' }).references(
      () => audienceSources.id
    ),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    tax: numeric('tax', { precision: 12, scale: 2 }).notNull().default('0'),
    // 0065: coach's manual tax override. NULL = auto (subtotal × tax_pct/100);
    // when set, used verbatim as the tax. Lets a coach handle exemptions.
    taxOverride: numeric('tax_override', { precision: 12, scale: 2 }),
    total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
    previousQuoteId: bigint('previous_quote_id', { mode: 'number' }).references(
      (): AnyPgColumn => quotes.id,
      { onDelete: 'set null' }
    ),
    // Durable link to the QBO `Estimate.Id` this quote was pushed to (0073).
    // Nullable: set only by the "Push to QuickBooks" action — present → update
    // the existing Estimate (read-before-write SyncToken); null → create one
    // and backfill this. The partial unique index gives push idempotency
    // (at most one Estimate per quote).
    quickbooksEstimateId: text('quickbooks_estimate_id'),
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
    // Unique only among pushed quotes — at most one quote per QBO Estimate (0073).
    uniqueIndex('quotes_quickbooks_estimate_id_idx')
      .on(table.quickbooksEstimateId)
      .where(sql`${table.quickbooksEstimateId} IS NOT NULL`),
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
