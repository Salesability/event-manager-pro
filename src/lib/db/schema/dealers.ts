import { index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';

// `prospect` = a quote drafted, no signed relationship yet. `active` = quote
// accepted (or admin manually flipped). Archived state is the existing
// `archivable.archivedAt` timestamp — independent of `status` (resolved in
// 0035 plan Open Question #1).
export const dealerStatus = pgEnum('dealer_status', ['prospect', 'active']);

export const dealers = pgTable(
  'dealers',
  {
    id: bigIdentity(),
    publicId: text('public_id').notNull().unique(),
    name: text('name').notNull(),
    address: text('address'),
    status: dealerStatus('status').notNull().default('active'),
    // Free-form acquisition source — "Book Your Event form", "referral",
    // "outbound", "trade show". Distinct from `audience_sources` (per-campaign
    // audience list). Lookup-formalized in v2 once values stabilize.
    acquiredVia: text('acquired_via'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    index('dealers_created_by_id_idx').on(table.createdById),
    index('dealers_updated_by_id_idx').on(table.updatedById),
    index('dealers_status_idx').on(table.status),
  ]
);
