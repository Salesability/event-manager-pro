import { eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { serviceItems } from '@/lib/db/schema';
import type { QboItem } from '@/lib/quickbooks/client';

// QuickBooks Item → `service_items` reconciliation (chunk 0071). **QBO is the
// item master:** the app's catalog is a read-through mirror, refreshed by the
// on-demand "Pull items" action. One pull makes `service_items` reflect QBO's
// active Item set:
//   match by `quickbooks_id` & fields differ -> UPDATE (overwrite from QBO)
//   match by `quickbooks_id` & identical     -> current (no-op)
//   no match                                  -> CREATE (insert linked)
//   linked row absent from QBO's active set   -> ARCHIVE
//   pre-existing unlinked row (quickbooks_id NULL) -> PURGE (the legacy SKUs)
//   non-syncable QBO item / derived-code clash -> SKIP
// The app never writes Items TO QBO (pull-only). `service_items` is a lookup
// table (no `actors`/`timestamps`), so no actor columns are stamped.

type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// ---------- mapping ----------

// Derive a stable, immutable `code` from a QBO Item: prefer its `Sku`, else a
// slug of its `Name`. `code` is UNIQUE in `service_items`; the classifier
// guards collisions among created rows.
export function slugifyItemCode(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

export type MappedItem = {
  qbId: string;
  code: string;
  label: string;
  unitPrice: string | null;
  description: string | null;
  isSyncable: boolean;
};

// QBO `Item` → `service_items` fields. `unitPrice` is the QBO `UnitPrice`
// (a number) rendered to the numeric string our column stores; absent → null.
// Only top-level Service / NonInventory items with a Name are syncable —
// Category / sub-item / Inventory / nameless records are skipped.
export function mapItemToServiceItem(item: QboItem): MappedItem {
  const name = (item.Name ?? '').trim();
  const sku = (item.Sku ?? '').trim();
  const description = (item.Description ?? '').trim();
  const type = item.Type ?? '';
  return {
    qbId: item.Id,
    code: sku || slugifyItemCode(name),
    label: name,
    // Canonicalize to the numeric(10,2) money shape up front: a QBO price like
    // 99.999 becomes '100.00' once, so the next pull compares equal (no perpetual
    // `update` churn) and we never hand the column an over-precise string.
    unitPrice: item.UnitPrice != null ? item.UnitPrice.toFixed(2) : null,
    description: description || null,
    isSyncable:
      (type === 'Service' || type === 'NonInventory') &&
      item.SubItem !== true &&
      !item.ParentRef &&
      name.length > 0,
  };
}

// ---------- classify (pure, read-only) ----------

export type ItemSyncAction = 'create' | 'update' | 'current' | 'archive' | 'purge' | 'skip';

export type ItemSyncPlanRow = {
  action: ItemSyncAction;
  code: string;
  label: string;
  unitPrice: string | null;
  description: string | null;
  qbId?: string; // present for rows sourced from a QBO item
  serviceItemId?: number; // present for rows resolved to an existing catalog row
  reason?: string; // for skip
};

export type ExistingServiceItem = {
  id: number;
  code: string;
  label: string;
  unitPrice: string | null;
  description: string | null;
  quickbooksId: string | null;
  archivedAt: Date | null;
};

const normText = (s: string | null): string => (s ?? '').trim();
const priceEqual = (a: string | null, b: string | null): boolean => {
  const na = a == null ? null : Number(a);
  const nb = b == null ? null : Number(b);
  if (na == null && nb == null) return true;
  if (na == null || nb == null) return false;
  return na === nb;
};

// Pure classifier: resolve each QBO item + each existing row to a planned action
// against the catalog snapshot. No DB, no writes — unit-tested directly.
export function classifyItemSyncPlan(
  items: QboItem[],
  existing: ExistingServiceItem[],
): ItemSyncPlanRow[] {
  const byQbId = new Map<string, ExistingServiceItem>();
  // Only LINKED codes guard create-collisions — unlinked legacy rows get purged,
  // so a new QBO item is free to reuse their code.
  const linkedCodes = new Set<string>();
  for (const e of existing) {
    if (e.quickbooksId) {
      byQbId.set(e.quickbooksId, e);
      linkedCodes.add(e.code);
    }
  }

  const rows: ItemSyncPlanRow[] = [];
  const activeQbIds = new Set<string>();
  const seenCreateCodes = new Set<string>();

  for (const item of items) {
    const m = mapItemToServiceItem(item);
    if (!m.isSyncable) {
      rows.push({
        action: 'skip',
        code: m.code,
        label: m.label,
        unitPrice: m.unitPrice,
        description: m.description,
        qbId: m.qbId,
        reason: 'non-syncable',
      });
      continue;
    }
    activeQbIds.add(m.qbId);

    const linked = byQbId.get(m.qbId);
    if (linked) {
      const differs =
        normText(linked.label) !== normText(m.label) ||
        !priceEqual(linked.unitPrice, m.unitPrice) ||
        normText(linked.description) !== normText(m.description) ||
        linked.archivedAt != null; // re-pull revives an archived row
      rows.push({
        action: differs ? 'update' : 'current',
        code: linked.code, // `code` is immutable — keep the existing one
        label: m.label,
        unitPrice: m.unitPrice,
        description: m.description,
        qbId: m.qbId,
        serviceItemId: linked.id,
      });
      continue;
    }

    if (linkedCodes.has(m.code) || seenCreateCodes.has(m.code)) {
      rows.push({
        action: 'skip',
        code: m.code,
        label: m.label,
        unitPrice: m.unitPrice,
        description: m.description,
        qbId: m.qbId,
        reason: 'code-collision',
      });
      continue;
    }
    seenCreateCodes.add(m.code);
    rows.push({
      action: 'create',
      code: m.code,
      label: m.label,
      unitPrice: m.unitPrice,
      description: m.description,
      qbId: m.qbId,
    });
  }

  for (const e of existing) {
    if (e.quickbooksId == null) {
      rows.push({
        action: 'purge',
        code: e.code,
        label: e.label,
        unitPrice: e.unitPrice,
        description: e.description,
        serviceItemId: e.id,
      });
    } else if (!activeQbIds.has(e.quickbooksId) && e.archivedAt == null) {
      rows.push({
        action: 'archive',
        code: e.code,
        label: e.label,
        unitPrice: e.unitPrice,
        description: e.description,
        qbId: e.quickbooksId,
        serviceItemId: e.id,
      });
    }
  }

  return rows;
}

// ---------- DB load + plan + apply ----------

export async function loadExistingServiceItems(exec: Executor = db): Promise<ExistingServiceItem[]> {
  return exec
    .select({
      id: serviceItems.id,
      code: serviceItems.code,
      label: serviceItems.label,
      unitPrice: serviceItems.unitPrice,
      description: serviceItems.description,
      quickbooksId: serviceItems.quickbooksId,
      archivedAt: serviceItems.archivedAt,
    })
    .from(serviceItems);
}

// Page-facing read-only change set for `/admin/quickbooks`.
export async function computeItemSyncPlan(
  items: QboItem[],
  exec: Executor = db,
): Promise<ItemSyncPlanRow[]> {
  const existing = await loadExistingServiceItems(exec);
  return classifyItemSyncPlan(items, existing);
}

export type ItemSyncResult = {
  created: number;
  updated: number;
  archived: number;
  purged: number;
  skipped: number;
};

export type ItemSyncSummary = {
  created: number;
  updated: number;
  archived: number;
  purged: number;
};

// Encodes an item sync result as `<created>.<updated>.<archived>.<purged>`. Feeds
// the combined `?qbsync=` flash param (chunk 0083 — was the standalone `?itemsynced=`).
export function encodeItemSyncSummary(r: ItemSyncSummary): string {
  return `${r.created}.${r.updated}.${r.archived}.${r.purged}`;
}

export function decodeItemSyncSummary(param: string): ItemSyncSummary | null {
  const parts = param.split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const [created, updated, archived, purged] = parts.map((p) => Number.parseInt(p, 10));
  return { created, updated, archived, purged };
}

// Apply the pull. The caller MUST pass a transaction-bound executor (the Server
// Action wraps this in `db.transaction`), so external readers never observe the
// brief mid-apply state and a failure rolls back rather than leaving a half-wiped
// catalog. No `= db` default — that's the type-level nudge to never run the
// destructive purge on the bare pool. Order matters: **purge legacy unlinked
// rows FIRST** so a created item's derived `code` can't collide with a
// soon-to-be-deleted legacy row, then archive, update, create.
//
// Destructive-pull guard: this pull archives linked rows absent from `items` and
// purges all unlinked rows. A response with **no syncable items** — an empty
// pull, a transient/partial read, or a page of only Category/sub-items — would
// otherwise archive every linked row + purge the catalog. So abort with NO
// writes unless there is at least one syncable item to anchor the sync.
// (Detecting a *partial* multi-page read where some syncable items are present
// but others are silently missing is a separate hardening — see the 0071
// follow-up before enabling a prod pull.)
export async function applyItemSync(items: QboItem[], exec: Executor): Promise<ItemSyncResult> {
  const result: ItemSyncResult = { created: 0, updated: 0, archived: 0, purged: 0, skipped: 0 };
  const syncable = items.filter((i) => mapItemToServiceItem(i).isSyncable);
  if (syncable.length === 0) return result;

  const existing = await loadExistingServiceItems(exec);
  const plan = classifyItemSyncPlan(items, existing);

  const purged = await exec
    .delete(serviceItems)
    .where(isNull(serviceItems.quickbooksId))
    .returning({ id: serviceItems.id });
  result.purged = purged.length;

  for (const row of plan) {
    if (row.action === 'skip') {
      result.skipped++;
      continue;
    }
    if (row.action === 'current' || row.action === 'purge') {
      continue; // current = no-op; purge already done by the blanket delete above
    }
    if (row.action === 'archive' && row.serviceItemId != null) {
      await exec
        .update(serviceItems)
        .set({ archivedAt: new Date() })
        .where(eq(serviceItems.id, row.serviceItemId));
      result.archived++;
      continue;
    }
    if (row.action === 'update' && row.serviceItemId != null) {
      // QBO is master — overwrite the mirrored fields; revive if archived.
      await exec
        .update(serviceItems)
        .set({
          label: row.label,
          unitPrice: row.unitPrice,
          description: row.description,
          archivedAt: null,
        })
        .where(eq(serviceItems.id, row.serviceItemId));
      result.updated++;
      continue;
    }
    if (row.action === 'create' && row.qbId) {
      const inserted = await exec
        .insert(serviceItems)
        .values({
          code: row.code,
          label: row.label,
          unitPrice: row.unitPrice,
          description: row.description,
          quickbooksId: row.qbId,
        })
        .onConflictDoNothing({
          target: serviceItems.quickbooksId,
          where: sql`${serviceItems.quickbooksId} is not null`,
        })
        .returning({ id: serviceItems.id });
      if (inserted.length > 0) result.created++;
      else result.skipped++;
    }
  }

  return result;
}
