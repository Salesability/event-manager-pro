import { resolveCodeRatePct, resolveProvinceLinksByName } from '@/lib/quickbooks/tax-sync';
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
  suggestionCodeId: string | null; // demoted name-matcher suggestion (UI pre-select)
};

function rateById(qboRates: QboTaxRate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of qboRates) if (r.RateValue != null) m.set(r.Id, r.RateValue);
  return m;
}

function fmtPct(n: number | null): string {
  return n == null ? 'rate n/a' : `${parseFloat(n.toFixed(3))}%`;
}

// Pure: the dropdown options — every ACTIVE code with its summed sales rate.
export function buildTaxCodeOptions(qboCodes: QboTaxCode[], qboRates: QboTaxRate[]): TaxCodeOption[] {
  const rmap = rateById(qboRates);
  return qboCodes
    .filter((c) => c.Active !== false)
    .map((c) => {
      const ratePct = resolveCodeRatePct(c, rmap);
      const name = c.Name ?? `#${c.Id}`;
      return { id: c.Id, name, ratePct, label: `${name} — ${fmtPct(ratePct)}` };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
  const suggByProvince = new Map(
    resolveProvinceLinksByName(appRows, active, rmap).map((s) => [s.province, s.taxCodeId]),
  );

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
      suggestionCodeId: suggByProvince.get(ar.province) ?? null,
    };
  });
}
