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
