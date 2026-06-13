import {
  bigint,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { quotes } from './quotes';

// One row per file a coach uploaded to ride alongside a quote email (0078 — the
// local-upload attachment spine). When a quote is sent, every row here is fetched
// from GCS and appended to the outgoing email's `attachments` array next to the
// rendered quote PDF (`src/features/quotes/actions.ts` `sendQuote`).
//
// **Snapshot discipline.** `filename`/`contentType`/`byteSize` are captured at
// upload time so the row stays self-contained for re-send + audit even though the
// bytes live in GCS at `storageKey`. The key scheme is
// `quotes/{quoteId}/attachments/{uuid}-{filename}` — the uuid prefix avoids
// collisions when the same filename is re-uploaded.
//
// **Retention.** Uploads are kept in GCS indefinitely (v1 owner decision — no
// background GC). Removing an attachment before send deletes the row (and
// best-effort deletes the GCS object); a cascade on quote delete drops the rows
// but not the objects.
//
// **0079 extension point.** The reusable document-library chunk (0079, deferred)
// adds a nullable `document_id` FK here in its own additive migration so a row can
// point at a library document instead of a one-off upload. This chunk adds no such
// column.
export const quoteAttachments = pgTable(
  'quote_attachments',
  {
    id: bigIdentity(),
    quoteId: bigint('quote_id', { mode: 'number' })
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    displayOrder: integer('display_order').notNull(),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('quote_attachments_quote_id_idx').on(table.quoteId, table.displayOrder),
    index('quote_attachments_created_by_id_idx').on(table.createdById),
    index('quote_attachments_updated_by_id_idx').on(table.updatedById),
  ]
);
