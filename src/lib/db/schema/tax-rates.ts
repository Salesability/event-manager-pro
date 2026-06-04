import { numeric, pgTable, text } from 'drizzle-orm/pg-core';
import { bigIdentity, timestamps } from './_columns';
import { caProvince } from './dealers';

// Province → combined Canadian sales-tax rate (GST / HST / PST / QST collapsed
// into a single percent). Admin-editable (0065); exactly one row per province
// (the shared `ca_province` enum, unique). `rate` is a percent with 3 decimals —
// QC's QST needs 14.975. Seeded with June-2026 rates in the create migration.
// Edited in place, never archived → `timestamps` (so `updated_at` tracks rate
// changes for billing audit).
export const taxRates = pgTable('tax_rates', {
  id: bigIdentity(),
  province: caProvince('province').notNull().unique(),
  label: text('label').notNull(),
  rate: numeric('rate', { precision: 6, scale: 3 }).notNull(),
  ...timestamps,
});
