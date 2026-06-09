import 'server-only';
import { asc, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { serviceItems } from '@/lib/db/schema';

export type ServiceItem = {
  id: number;
  code: string;
  label: string;
  unitPrice: string | null;
  description: string | null;
  sortOrder: number;
};

export async function loadServiceItems(): Promise<ServiceItem[]> {
  return db
    .select({
      id: serviceItems.id,
      code: serviceItems.code,
      label: serviceItems.label,
      unitPrice: serviceItems.unitPrice,
      description: serviceItems.description,
      sortOrder: serviceItems.sortOrder,
    })
    .from(serviceItems)
    .where(isNull(serviceItems.archivedAt))
    .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.label));
}

// Admin read-only catalog view (chunk 0072). Unlike `loadServiceItems` (the
// composer feed, non-archived), this returns EVERY row — including archived —
// plus the `quickbooks_id` link + `archived_at`, ordered by `code`, so the
// /admin/quickbooks "Service items" list can show the full picture. Read-only;
// there is no in-app item CRUD since 0071 (QuickBooks is the item master).
export type ServiceItemAdminRow = {
  id: number;
  code: string;
  label: string;
  unitPrice: string | null;
  description: string | null;
  quickbooksId: string | null;
  archivedAt: Date | null;
};

export async function loadServiceItemsForAdmin(): Promise<ServiceItemAdminRow[]> {
  return db
    .select({
      id: serviceItems.id,
      code: serviceItems.code,
      label: serviceItems.label,
      unitPrice: serviceItems.unitPrice,
      description: serviceItems.description,
      quickbooksId: serviceItems.quickbooksId,
      archivedAt: serviceItems.archivedAt,
    })
    .from(serviceItems)
    .orderBy(asc(serviceItems.code));
}
