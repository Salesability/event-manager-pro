import { numeric, pgTable, text } from 'drizzle-orm/pg-core';
import { bigIdentity, timestamps } from './_columns';
import { caProvince } from './dealers';

// Province → combined Canadian sales-tax rate (GST / HST / PST / QST collapsed
// into a single percent). Exactly one row per province (the shared `ca_province`
// enum, unique). `rate` is a percent with 3 decimals — QC's QST needs 14.975.
// Seeded with June-2026 rates in the create migration (0065). Since 0075,
// **QuickBooks is the source of truth for `rate`**: the "Pull tax codes" sync
// name-matches a province to its QBO TaxCode and adopts that code's rate; the
// in-app editor was removed. Unmatched provinces keep the seeded rate as a
// fallback. Never archived → `timestamps` (so `updated_at` tracks rate changes
// for billing audit).
export const taxRates = pgTable('tax_rates', {
  id: bigIdentity(),
  province: caProvince('province').notNull().unique(),
  label: text('label').notNull(),
  rate: numeric('rate', { precision: 6, scale: 3 }).notNull(),
  // QBO `TaxCode.Id` this province maps to (0074), or null when no QBO tax code
  // NAME-matches the province (0075). A province is "QB-managed" ⇔ this is non-
  // null. Set by the "Pull tax codes" sync (which also adopts the code's rate);
  // drives the Estimate push's per-line `TaxCodeRef`. Null → a taxed quote on
  // this province fails the push pre-flight (no code → QBO can't compute tax).
  quickbooksTaxCodeId: text('quickbooks_tax_code_id'),
  ...timestamps,
});
