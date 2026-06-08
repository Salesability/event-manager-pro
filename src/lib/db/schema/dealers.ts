import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { CA_PROVINCE_CODES } from '@/lib/ca-provinces';
import { actors, archivable, bigIdentity, timestamps } from './_columns';

// `prospect` = a quote drafted, no signed relationship yet. `active` = quote
// accepted (or admin manually flipped). Archived state is the existing
// `archivable.archivedAt` timestamp — independent of `status` (resolved in
// 0035 plan Open Question #1).
export const dealerStatus = pgEnum('dealer_status', ['prospect', 'active']);

// Canada's province/territory (0065) — drives province-based sales-tax
// computation on quotes. Code list is shared from `@/lib/ca-provinces`.
export const caProvince = pgEnum('ca_province', CA_PROVINCE_CODES);

export const dealers = pgTable(
  'dealers',
  {
    id: bigIdentity(),
    publicId: text('public_id').notNull().unique(),
    name: text('name').notNull(),
    address: text('address'),
    // Nullable: existing dealers are backfilled by admins. Drives sales-tax
    // computation (0065) via the `tax_rates` lookup.
    province: caProvince('province'),
    status: dealerStatus('status').notNull().default('active'),
    // Free-form acquisition source — "Book Your Event form", "referral",
    // "outbound", "trade show". Distinct from `audience_sources` (per-campaign
    // audience list). Lookup-formalized in v2 once values stabilize.
    acquiredVia: text('acquired_via'),
    // Durable link to the QuickBooks Online `Customer.Id` this dealer mirrors
    // (0069). Nullable: dealers created in-app or seeded by the 0060 name-match
    // import start unlinked; the on-demand QB sync backfills the ID onto a
    // name+address match (prod path) or stamps it on insert (sandbox path). The
    // partial unique index below enforces at-most-one dealer per QB customer
    // while allowing many unlinked NULLs.
    quickbooksId: text('quickbooks_id'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    index('dealers_created_by_id_idx').on(table.createdById),
    index('dealers_updated_by_id_idx').on(table.updatedById),
    index('dealers_status_idx').on(table.status),
    // Unique only among linked dealers — `WHERE quickbooks_id IS NOT NULL` keeps
    // the many unlinked NULLs out of the uniqueness constraint.
    uniqueIndex('dealers_quickbooks_id_idx')
      .on(table.quickbooksId)
      .where(sql`${table.quickbooksId} IS NOT NULL`),
  ]
);
