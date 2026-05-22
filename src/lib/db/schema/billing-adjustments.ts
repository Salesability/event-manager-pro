import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { campaigns } from './campaigns';

// 0059: per-campaign billing overrides for the /reports surface. Reports are
// derived from `campaigns` today; this table is the persisted adjustment
// layer that lets an admin tune the invoice-relevant quantities WITHOUT
// mutating the campaign source-of-truth. The original campaign value stays
// intact and recoverable — clearing an adjustment deletes its row, and the
// report falls back to the campaign column.
//
// EAV-by-field shape (one row per campaign × adjustable field), chosen over
// nullable `billing_*` columns on `campaigns` so billing concerns stay off
// the domain row (owner decision 2026-05-22). `field` is constrained to the
// four quantity columns the owner adjusts at invoice time; `value` mirrors
// those columns' `integer` type. A future dollar-amount adjustment would add
// a field value here (and likely revisit the `value` type).
export const BILLING_ADJUSTMENT_FIELDS = [
  'qty_records',
  'sms_email',
  'letters',
  'bdc',
] as const;

export const billingAdjustments = pgTable(
  'billing_adjustments',
  {
    id: bigIdentity(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    // The campaign column this row overrides. Mirrors the actual column name
    // so the mapping to `campaigns` is self-documenting.
    field: text('field').notNull(),
    // The overriding quantity. Non-negative; same `integer` domain as the
    // campaign columns it replaces.
    value: integer('value').notNull(),
    ...timestamps,
    ...actors,
  },
  (table) => [
    // At most one adjustment per (campaign, field) — the upsert target and
    // the "is this field overridden?" lookup key.
    unique('billing_adjustments_campaign_field_uq').on(table.campaignId, table.field),
    index('billing_adjustments_campaign_id_idx').on(table.campaignId),
    index('billing_adjustments_created_by_id_idx').on(table.createdById),
    index('billing_adjustments_updated_by_id_idx').on(table.updatedById),
    check(
      'billing_adjustments_field_check',
      sql`${table.field} in ('qty_records', 'sms_email', 'letters', 'bdc')`,
    ),
    check('billing_adjustments_value_nonneg_check', sql`${table.value} >= 0`),
  ],
);
