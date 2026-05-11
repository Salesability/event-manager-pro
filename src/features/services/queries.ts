import 'server-only';
import { asc, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { serviceItems } from '@/lib/db/schema';

export type ServiceItemUnit = 'flat' | 'per-record' | 'per-touch' | 'per-day' | 'range';

export type ServiceItem = {
  id: number;
  code: string;
  label: string;
  unit: ServiceItemUnit;
  unitPrice: string | null;
  unitPriceMin: string | null;
  unitPriceMax: string | null;
  description: string | null;
  sortOrder: number;
};

export async function loadServiceItems(): Promise<ServiceItem[]> {
  return db
    .select({
      id: serviceItems.id,
      code: serviceItems.code,
      label: serviceItems.label,
      unit: serviceItems.unit,
      unitPrice: serviceItems.unitPrice,
      unitPriceMin: serviceItems.unitPriceMin,
      unitPriceMax: serviceItems.unitPriceMax,
      description: serviceItems.description,
      sortOrder: serviceItems.sortOrder,
    })
    .from(serviceItems)
    .where(isNull(serviceItems.archivedAt))
    .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.label));
}
