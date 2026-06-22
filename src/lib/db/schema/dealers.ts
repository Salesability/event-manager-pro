import { sql } from 'drizzle-orm';
import { date, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { CA_PROVINCE_CODES } from '@/lib/ca-provinces';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { authUsers } from './auth';

// `prospect` = a quote drafted, no signed relationship yet. `active` = quote
// accepted (or admin manually flipped). Archived state is the existing
// `archivable.archivedAt` timestamp — independent of `status` (resolved in
// 0035 plan Open Question #1).
export const dealerStatus = pgEnum('dealer_status', ['prospect', 'active']);

// Canada's province/territory (0065) — drives province-based sales-tax
// computation on quotes. Code list is shared from `@/lib/ca-provinces`.
export const caProvince = pgEnum('ca_province', CA_PROVINCE_CODES);

// Prospecting funnel position (0087). Enum order = funnel order (drives default
// sort + the 0088 dashboard's column order). **Won is NOT a stage** — it's
// `status='active'` via `convertProspectToActive` (+ the 0084 QBO push), so the
// pipeline and the commercial spine stay one system. `on_hold` and `lost` ARE
// stages (the dashboard counts them); `lost` does NOT auto-archive (decision.md
// D1).
export const dealerPipelineStage = pgEnum('dealer_pipeline_stage', [
  'new',
  'researching',
  'contacted',
  'follow_up',
  'meeting_booked',
  'proposal_sent',
  'negotiation',
  'on_hold',
  'lost',
]);

// Rep-set work priority for the commitment queue (0087).
export const dealerPriority = pgEnum('dealer_priority', ['high', 'medium', 'low']);

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
    // Rooftop switchboard line (0086 Atlantic BD import). A dealer-level
    // attribute, NOT a contact identifier — multiple rooftops share one number,
    // which the `contact_identifiers` active-unique index forbids. The QBO push
    // (0086) prefers this for the Customer `PrimaryPhone` over the contact phone.
    phone: text('phone'),
    // Vehicle brand the rooftop carries ("FCA", "Ford/Lincoln", "General
    // Motors"). Free-form text from the BD list (0086); not yet a lookup.
    manufacturer: text('manufacturer'),
    // Free-form dealer notes. The BD-list import (0086) folds Group / Contact
    // Verification / Co-op eligibility / original sheet notes into a readable
    // block here; otherwise hand-entered.
    notes: text('notes'),
    // Durable link to the QuickBooks Online `Customer.Id` this dealer mirrors
    // (0069). Nullable: dealers created in-app or seeded by the 0060 name-match
    // import start unlinked; the on-demand QB sync backfills the ID onto a
    // name+address match (prod path) or stamps it on insert (sandbox path). The
    // partial unique index below enforces at-most-one dealer per QB customer
    // while allowing many unlinked NULLs.
    quickbooksId: text('quickbooks_id'),
    // --- Prospecting pipeline (0087). All nullable: active/existing dealers
    // don't need a funnel position; the 188 cold Atlantic prospects (0086)
    // backfill to `new`. ---
    pipelineStage: dealerPipelineStage('pipeline_stage'),
    priority: dealerPriority('priority'),
    // The coach who owns working this dealer. The picklist is coaches-only
    // (decision.md D2), but the FK stays generic `auth.users` so a future widen
    // to all-staff needs no migration. ON DELETE SET NULL (don't orphan on a
    // user delete), matching the `actors` pattern.
    ownerId: uuid('owner_id').references(() => authUsers.id, { onDelete: 'set null' }),
    // The rep's current promise in their own words ("call Tuesday", "send
    // pricing Friday") + its due date — drives the /dealerships commitment
    // queue's overdue / due-soon / idle buckets. `next_action_at` is a calendar
    // date (no time-of-day), so `date` not `timestamptz`.
    nextAction: text('next_action'),
    nextActionAt: date('next_action_at'),
    // Stamped by `logDealerActivity` on the last logged touch — distinct from
    // the per-contact `dealer_contacts.lastContactedAt`. The queue's "idle"
    // bucket reads it (no next action AND not recently contacted).
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    // Stamped on every `pipeline_stage` change. Written here (0087); READ by the
    // 0088 dashboard's "stalled in stage" blocker — added now so 0088 needs no
    // migration.
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    index('dealers_created_by_id_idx').on(table.createdById),
    index('dealers_updated_by_id_idx').on(table.updatedById),
    index('dealers_status_idx').on(table.status),
    index('dealers_pipeline_stage_idx').on(table.pipelineStage),
    index('dealers_owner_id_idx').on(table.ownerId),
    index('dealers_next_action_at_idx').on(table.nextActionAt),
    // Unique only among linked dealers — `WHERE quickbooks_id IS NOT NULL` keeps
    // the many unlinked NULLs out of the uniqueness constraint.
    uniqueIndex('dealers_quickbooks_id_idx')
      .on(table.quickbooksId)
      .where(sql`${table.quickbooksId} IS NOT NULL`),
  ]
);
