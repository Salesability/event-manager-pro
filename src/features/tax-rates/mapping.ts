import { resolveCodeRatePct } from '@/lib/quickbooks/tax-sync';
import type { QboTaxCode, QboTaxRate } from '@/lib/quickbooks/client';

// View-model for the /admin/lookups tax-code mapping UI (0076). Built SERVER-SIDE
// from the connected company's live TaxCodes/TaxRates + the app's `tax_rates`; the
// client component renders these plain objects and imports only the *types*
// (`import type`, erased — never pulls this server module into the client bundle).
//
// Replaces 0075's auto-apply name heuristic: the matcher (`resolveProvinceLinksByName`)
// is demoted to a *suggestion* (pre-selects a likely code; the admin confirms). The
// rate is QB-sourced via the group-aware `resolveCodeRatePct` (sums a group code's
// GST+PST/QST components — e.g. QC's 5% + 9.975% = 14.975%).

export type TaxCodeOption = {
  id: string;
  name: string;
  /** Summed sales rate (group-aware); null when no resolvable sales rate. */
  ratePct: number | null;
  /** Display label, e.g. "HST ON — 13%" / "GST 5% — rate n/a". */
  label: string;
};

export type ProvinceMappingInput = {
  province: string;
  label: string;
  rate: string; // numeric(6,3) string, e.g. "13.000"
  quickbooksTaxCodeId: string | null;
};

export type ProvinceMappingRow = {
  province: string;
  label: string;
  appRate: string;
  currentCodeId: string | null;
  currentCodeName: string | null; // resolved from the live set; null if unset/broken
  currentCodeRatePct: number | null;
  managed: boolean; // currentCodeId != null
  brokenLink: boolean; // mapped to an id absent from the live active set
  drift: boolean; // managed + the linked code's QB rate differs from the app rate
};

// Loader result for the `/admin/lookups` mapping section. When QuickBooks is
// connected, the full view-model + dropdown options; when not, a read-only list
// (the dropdown needs live codes), rendered with a "connect QuickBooks" hint.
export type TaxMappingAdminData =
  | { connected: true; rows: ProvinceMappingRow[]; options: TaxCodeOption[] }
  | { connected: false; rows: ProvinceMappingInput[] };

function rateById(qboRates: QboTaxRate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of qboRates) if (r.RateValue != null) m.set(r.Id, r.RateValue);
  return m;
}

function fmtPct(n: number | null): string {
  return n == null ? 'rate n/a' : `${parseFloat(n.toFixed(3))}%`;
}

// Pure: the dropdown options — every ACTIVE code whose sales rate RESOLVES (so it
// can be adopted). Codes with no resolvable sales rate (adjustment/non-sales
// codes) are excluded so an admin can't map a province to a code that would leave
// a stale `tax_rates.rate` (0076 — the action enforces this too, defense-in-depth).
export function buildTaxCodeOptions(qboCodes: QboTaxCode[], qboRates: QboTaxRate[]): TaxCodeOption[] {
  const rmap = rateById(qboRates);
  return qboCodes
    .filter((c) => c.Active !== false)
    .map((c) => {
      const ratePct = resolveCodeRatePct(c, rmap);
      const name = c.Name ?? `#${c.Id}`;
      return { id: c.Id, name, ratePct, label: `${name} — ${fmtPct(ratePct)}` };
    })
    .filter((o) => o.ratePct != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type RateRefreshResult = {
  /** Rate-only updates for mapped provinces whose linked code's rate changed.
   *  `quickbooksTaxCodeId` is the code the rate was computed from — the executor
   *  compare-and-sets on it so a concurrent re-map can't get the wrong rate. */
  writes: { province: string; rate: string; quickbooksTaxCodeId: string }[];
  /** Provinces whose mapped code is absent from the live set — left untouched. */
  broken: string[];
};

// Pure: rate-ONLY refresh for already-mapped provinces — re-reads each linked
// code's current (group-aware) rate and updates `tax_rates.rate` when it changed.
// It NEVER changes a code link (so it can't clobber the mapping — the safe
// replacement for 0075's auto-apply pull). A mapped code absent from the live set
// is reported `broken` (left as-is, not cleared); unmapped provinces are ignored.
export function planRateRefresh(
  appRows: ProvinceMappingInput[],
  qboCodes: QboTaxCode[],
  qboRates: QboTaxRate[],
): RateRefreshResult {
  const rmap = rateById(qboRates);
  const byId = new Map(qboCodes.filter((c) => c.Active !== false).map((c) => [c.Id, c]));
  const writes: { province: string; rate: string; quickbooksTaxCodeId: string }[] = [];
  const broken: string[] = [];
  for (const ar of appRows) {
    if (ar.quickbooksTaxCodeId == null) continue; // only mapped provinces
    const code = byId.get(ar.quickbooksTaxCodeId);
    if (!code) {
      broken.push(ar.province);
      continue;
    }
    const ratePct = resolveCodeRatePct(code, rmap);
    if (ratePct == null) continue; // unresolvable → leave the rate
    const newRate = ratePct.toFixed(3);
    if (newRate !== ar.rate) {
      writes.push({ province: ar.province, rate: newRate, quickbooksTaxCodeId: ar.quickbooksTaxCodeId });
    }
  }
  return { writes, broken };
}

// Pure: one row per province — its current mapping, drift/broken-link flags, and a
// name-match suggestion for the dropdown pre-select.
export function buildProvinceMappingRows(
  appRows: ProvinceMappingInput[],
  qboCodes: QboTaxCode[],
  qboRates: QboTaxRate[],
): ProvinceMappingRow[] {
  const rmap = rateById(qboRates);
  const active = qboCodes.filter((c) => c.Active !== false);
  const byId = new Map(active.map((c) => [c.Id, c]));

  return appRows.map((ar) => {
    const currentCodeId = ar.quickbooksTaxCodeId;
    const liveCode = currentCodeId != null ? byId.get(currentCodeId) : undefined;
    const currentCodeRatePct = liveCode ? resolveCodeRatePct(liveCode, rmap) : null;
    const brokenLink = currentCodeId != null && liveCode == null;
    const drift =
      liveCode != null && currentCodeRatePct != null && currentCodeRatePct.toFixed(3) !== ar.rate;
    return {
      province: ar.province,
      label: ar.label,
      appRate: ar.rate,
      currentCodeId,
      currentCodeName: liveCode?.Name ?? null,
      currentCodeRatePct,
      managed: currentCodeId != null,
      brokenLink,
      drift,
    };
  });
}
