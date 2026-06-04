import { describe, expect, it } from 'vitest';
import { rateForProvince, type TaxRate } from './tax-rates';

// 0065 — pure rate-selection contract. (Seed-data correctness — 13 rows, QC =
// 14.975 — is verified when the migration applies to stage/prod, not here.)

const rows: TaxRate[] = [
  { province: 'AB', label: 'Alberta', rate: '5.000' },
  { province: 'ON', label: 'Ontario', rate: '13.000' },
  { province: 'QC', label: 'Quebec', rate: '14.975' },
];

describe('rateForProvince (0065)', () => {
  it('returns the numeric rate for a known province (incl. 3-decimal QST)', () => {
    expect(rateForProvince(rows, 'QC')).toBe(14.975);
    expect(rateForProvince(rows, 'ON')).toBe(13);
    expect(rateForProvince(rows, 'AB')).toBe(5);
  });

  it('returns null for a province with no rate row', () => {
    expect(rateForProvince(rows, 'BC')).toBeNull();
  });

  it('returns null when the province is unset', () => {
    expect(rateForProvince(rows, null)).toBeNull();
  });
});
