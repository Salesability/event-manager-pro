import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { CA_PROVINCE_CODES, CA_PROVINCE_NAMES, type CaProvinceCode } from '@/lib/ca-provinces';
import { db } from '@/lib/db';
import { dealers } from '@/lib/db/schema';
import type { QboAddr, QboCustomer } from '@/lib/quickbooks/client';

// QuickBooks Customer to `dealers` reconciliation (chunk 0069). Turns the 0068
// read-only viewer into a sync surface: classify each QB customer against our
// dealers (read-only `computeDealerSyncPlan`) and apply the change set
// (`applyDealerSync`). One env-agnostic upsert path:
//   match by `quickbooks_id`  -> already linked (no-op)
//   else match by lower(name)+lower(address) & QB id NULL -> backfill the QB id
//   else match by name+address but linked to a DIFFERENT QB id -> skip-collision
//   else -> insert a fresh dealer stamped with the QB id
// Local `name`/`address` are NEVER clobbered; `province` backfills only when null
// (mirrors the 0060 importer). Sandbox inserts dealers fresh; prod backfills QB
// ids onto the dealers the 0060 import seeded.
//
// The mapping helpers (`mapProvince` / `formatAddress` / `mapCustomerToDealer`)
// are DUPLICATED from `scripts/import-from-quickbooks.ts` -- rewiring that
// one-time script to call this module is an intent non-goal, so the two copies
// must be kept in sync by hand (the unit tests pin the QBO-to-dealer behavior).
// Contact/people fields are intentionally absent here: `quickbooks_id` lands on
// the company (`dealers`), never on `contacts`.

// `db` and a transaction handle both satisfy the select/insert/update surface we
// use -- accepting either lets the integration test pass a rolled-back tx so it
// never persists to the shared DB.
type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const generatePublicId = () => randomBytes(9).toString('base64url');

// ---------- mapping (duplicated from the 0060 import; keep in sync) ----------

// QBO `CountrySubDivisionCode` is usually the 2-letter province code (= our
// `ca_province` enum) but tolerate full names + the real-data spellings below.
// Anything that isn't one of the 13 CA provinces maps to null (province-less).
const PROVINCE_BY_NAME: Record<string, CaProvinceCode> = Object.fromEntries(
  CA_PROVINCE_CODES.map((c) => [CA_PROVINCE_NAMES[c].toLowerCase(), c]),
);
const PROVINCE_ALIASES: Record<string, CaProvinceCode> = {
  PEI: 'PE',
  NF: 'NL',
  NFLD: 'NL',
  NEWFOUNDLAND: 'NL',
  PQ: 'QC',
};

export function mapProvince(raw?: string | null): CaProvinceCode | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if ((CA_PROVINCE_CODES as readonly string[]).includes(upper)) {
    return upper as CaProvinceCode;
  }
  return PROVINCE_ALIASES[upper] ?? PROVINCE_BY_NAME[v.toLowerCase()] ?? null;
}

export function formatAddress(a?: QboAddr): string | null {
  if (!a) return null;
  const cityLine = [a.City, a.CountrySubDivisionCode, a.PostalCode]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const parts = [a.Line1, a.Line2, a.Line3, cityLine, a.Country]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  const joined = parts.join(', ');
  return joined || null;
}

export type MappedCustomer = {
  qbId: string;
  name: string;
  address: string | null;
  province: CaProvinceCode | null;
  isJob: boolean;
};

// QBO `Customer` to dealer fields. `name` is `CompanyName` with a `DisplayName`
// fallback (individuals carry only the latter). Province prefers billing, falls
// through to shipping when billing's subdivision is blank/unrecognized.
export function mapCustomerToDealer(c: QboCustomer): MappedCustomer {
  const name = (c.CompanyName?.trim() || c.DisplayName?.trim() || '').trim();
  return {
    qbId: c.Id,
    name,
    address: formatAddress(c.BillAddr) ?? formatAddress(c.ShipAddr),
    province:
      mapProvince(c.BillAddr?.CountrySubDivisionCode) ??
      mapProvince(c.ShipAddr?.CountrySubDivisionCode),
    isJob: c.Job === true || !!c.ParentRef,
  };
}

// ---------- classify (pure, read-only) ----------

export type SyncAction = 'create' | 'link' | 'already-linked' | 'skip-collision';

// One planned change per (non-job, named) QB customer -- the read-only diff the
// page renders. `dealerId`/`dealerName` are carried for `link`/`already-linked`/
// `skip-collision` (the existing dealer the customer resolved to).
export type SyncPlanRow = {
  qbId: string;
  company: string;
  email: string | null;
  phone: string | null;
  action: SyncAction;
  dealerId?: number;
  dealerName?: string;
};

// The existing-dealer snapshot the classifier matches against. Loaded once
// (batch) so classification is in-memory, not N per-customer queries.
export type ExistingDealer = {
  id: number;
  name: string;
  address: string | null;
  province: CaProvinceCode | null;
  quickbooksId: string | null;
};

// Composite (name, address) match key. JSON-encoding the pair makes the key
// unambiguous -- the structural quotes/comma mean a name can never run into an
// address to fake a match -- without embedding a separator byte in the source.
const nameAddrKey = (name: string, address: string | null) =>
  JSON.stringify([name.toLowerCase(), (address ?? '').toLowerCase()]);

// Pure classifier: resolve each customer's action against the dealer snapshot.
// Skips `Job: true` sub-customers and nameless records (matches the 0060 seed).
// No DB, no writes -- unit-tested directly with a seeded `existing` set.
export function classifyDealerSyncPlan(
  customers: QboCustomer[],
  existing: ExistingDealer[],
): SyncPlanRow[] {
  const byQbId = new Map<string, ExistingDealer>();
  const byNameAddr = new Map<string, ExistingDealer>();
  for (const d of existing) {
    if (d.quickbooksId) byQbId.set(d.quickbooksId, d);
    byNameAddr.set(nameAddrKey(d.name, d.address), d);
  }

  const rows: SyncPlanRow[] = [];
  for (const c of customers) {
    const m = mapCustomerToDealer(c);
    if (m.isJob || !m.name) continue;

    const base = {
      qbId: m.qbId,
      company: m.name,
      email: c.PrimaryEmailAddr?.Address ?? null,
      phone: c.PrimaryPhone?.FreeFormNumber ?? c.Mobile?.FreeFormNumber ?? null,
    };

    const linked = byQbId.get(m.qbId);
    if (linked) {
      rows.push({ ...base, action: 'already-linked', dealerId: linked.id, dealerName: linked.name });
      continue;
    }

    const match = byNameAddr.get(nameAddrKey(m.name, m.address));
    if (match) {
      rows.push({
        ...base,
        action: match.quickbooksId == null ? 'link' : 'skip-collision',
        dealerId: match.id,
        dealerName: match.name,
      });
      continue;
    }

    rows.push({ ...base, action: 'create' });
  }
  return rows;
}

// ---------- DB load + plan + apply ----------

// Batch-load the dealer snapshot the classifier needs (id + match keys + the
// QB id, plus province to drive the null-only backfill).
export async function loadExistingDealers(exec: Executor = db): Promise<ExistingDealer[]> {
  return exec
    .select({
      id: dealers.id,
      name: dealers.name,
      address: dealers.address,
      province: dealers.province,
      quickbooksId: dealers.quickbooksId,
    })
    .from(dealers);
}

// Page-facing: load the dealer snapshot once and classify. Read-only -- computes
// the change set shown on `/admin/quickbooks` without touching the DB.
export async function computeDealerSyncPlan(
  customers: QboCustomer[],
  exec: Executor = db,
): Promise<SyncPlanRow[]> {
  const existing = await loadExistingDealers(exec);
  return classifyDealerSyncPlan(customers, existing);
}

export type SyncResult = {
  created: number;
  linked: number;
  alreadyLinked: number;
  skipped: number;
};

export type SyncSummary = { created: number; linked: number; skipped: number };

// Encodes a dealer sync result as `<created>.<linked>.<skipped>`. Feeds the
// combined `?qbsync=` flash param (chunk 0083 — was the standalone `?synced=`
// before the dealer/item sync buttons merged into one). Pure → unit-tested.
export function encodeSyncSummary(r: SyncSummary): string {
  return `${r.created}.${r.linked}.${r.skipped}`;
}

export function decodeSyncSummary(param: string): SyncSummary | null {
  const parts = param.split('.');
  if (parts.length !== 3) return null;
  // Each segment must be all-digits — `parseInt` alone would accept '1x' (-> 1)
  // or '1e9' (-> 1) and render a bogus tampered-URL summary.
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const [created, linked, skipped] = parts.map((p) => Number.parseInt(p, 10));
  // A 309+ digit (all-digit) segment overflows the double to Infinity, which the
  // regex still admits — reject anything that isn't a safe integer.
  if (![created, linked, skipped].every(Number.isSafeInteger)) return null;
  return { created, linked, skipped };
}

// Apply the change set. Re-resolves the plan against current DB state (fresh
// snapshot at apply time) and writes per row. Idempotent: a re-run sees linked
// dealers as `already-linked` and no-ops. No outer transaction -- each row is
// independent and a partial apply self-heals on re-run (mirrors the 0060
// script). The `link`/`create` writes are guarded so an intra-batch name
// collision (two QB customers resolving to the same dealer) loses the race
// gracefully -> counted as `skipped`, never clobbering an existing QB id.
export async function applyDealerSync(
  customers: QboCustomer[],
  actorId: string | null,
  exec: Executor = db,
): Promise<SyncResult> {
  const existing = await loadExistingDealers(exec);
  const plan = classifyDealerSyncPlan(customers, existing);
  const provinceById = new Map(existing.map((d) => [d.id, d.province]));
  const customerByQbId = new Map(customers.map((c) => [c.Id, c]));

  const result: SyncResult = { created: 0, linked: 0, alreadyLinked: 0, skipped: 0 };

  for (const row of plan) {
    if (row.action === 'already-linked') {
      result.alreadyLinked++;
      continue;
    }
    if (row.action === 'skip-collision') {
      result.skipped++;
      continue;
    }

    const customer = customerByQbId.get(row.qbId);
    if (!customer) continue; // unreachable: plan rows come from `customers`
    const m = mapCustomerToDealer(customer);

    if (row.action === 'link' && row.dealerId != null) {
      // Backfill the QB id (+ province only when the dealer has none). Guarded
      // on `quickbooks_id IS NULL` so a second customer can't clobber a link.
      const patch: { quickbooksId: string; updatedById: string | null; province?: CaProvinceCode } = {
        quickbooksId: m.qbId,
        updatedById: actorId,
      };
      if (provinceById.get(row.dealerId) == null && m.province != null) {
        patch.province = m.province;
      }
      const updated = await exec
        .update(dealers)
        .set(patch)
        .where(and(eq(dealers.id, row.dealerId), isNull(dealers.quickbooksId)))
        .returning({ id: dealers.id });
      if (updated.length > 0) result.linked++;
      else result.skipped++;
      continue;
    }

    // create -- insert a fresh dealer stamped with the QB id. `onConflictDoNothing`
    // on the partial unique index makes a double-click / concurrent run a no-op
    // rather than a constraint error.
    const inserted = await exec
      .insert(dealers)
      .values({
        publicId: generatePublicId(),
        name: m.name,
        address: m.address,
        province: m.province,
        status: 'active',
        acquiredVia: 'QuickBooks sync',
        quickbooksId: m.qbId,
        createdById: actorId,
        updatedById: actorId,
      })
      .onConflictDoNothing({
        target: dealers.quickbooksId,
        where: sql`${dealers.quickbooksId} is not null`,
      })
      .returning({ id: dealers.id });
    if (inserted.length > 0) result.created++;
    else result.skipped++;
  }

  return result;
}
