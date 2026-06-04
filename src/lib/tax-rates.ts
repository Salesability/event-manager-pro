import type { CaProvinceCode } from './ca-provinces';

// Client-safe tax-rate shape + pure rate selection (0065). No server imports,
// so the composer/admin UI and unit tests can use it; the DB loaders live in
// `src/features/tax-rates/queries.ts`.

export type TaxRate = {
  province: CaProvinceCode;
  label: string;
  /** numeric(6,3) percent as a string, e.g. '14.975'. */
  rate: string;
};

/** Combined sales-tax percent (number) for a province from loaded rows, or
 *  null when the province is unset or has no rate row. */
export function rateForProvince(
  rows: TaxRate[],
  province: CaProvinceCode | null,
): number | null {
  if (!province) return null;
  const row = rows.find((r) => r.province === province);
  return row ? Number(row.rate) : null;
}
