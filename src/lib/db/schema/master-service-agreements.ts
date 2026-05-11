import { bigint, index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { dealers } from './dealers';

export const msaStatus = pgEnum('msa_status', [
  'pending',
  'active',
  'expired',
  'terminated',
]);

export const masterServiceAgreements = pgTable(
  'master_service_agreements',
  {
    id: bigIdentity(),
    dealerId: bigint('dealer_id', { mode: 'number' })
      .notNull()
      .references(() => dealers.id, { onDelete: 'restrict' }),
    status: msaStatus('status').notNull().default('pending'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    signedPdfStorageKey: text('signed_pdf_storage_key'),
    dropboxSignDocumentId: text('dropbox_sign_document_id'),
    terminationNoticeDate: timestamp('termination_notice_date', { withTimezone: true }),
    terminationEffectiveDate: timestamp('termination_effective_date', { withTimezone: true }),
    templateVersion: text('template_version').notNull(),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('master_service_agreements_dealer_id_idx').on(table.dealerId),
    index('master_service_agreements_dealer_id_status_idx').on(table.dealerId, table.status),
    index('master_service_agreements_expires_at_idx').on(table.expiresAt),
    index('master_service_agreements_created_by_id_idx').on(table.createdById),
    index('master_service_agreements_updated_by_id_idx').on(table.updatedById),
  ]
);
