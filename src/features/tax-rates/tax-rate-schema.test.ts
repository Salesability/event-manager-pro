import { describe, expect, it } from 'vitest';
import { taxRateUpdateSchema } from './tax-rate-schema';

describe('taxRateUpdateSchema (0065)', () => {
  it('accepts a valid province + rate (incl. 3-decimal QST)', () => {
    expect(taxRateUpdateSchema.safeParse({ province: 'ON', rate: '13.000' }).success).toBe(true);
    expect(taxRateUpdateSchema.safeParse({ province: 'QC', rate: '14.975' }).success).toBe(true);
    expect(taxRateUpdateSchema.safeParse({ province: 'AB', rate: '5' }).success).toBe(true);
  });

  it('rejects a rate with more than 3 decimals', () => {
    expect(taxRateUpdateSchema.safeParse({ province: 'ON', rate: '13.0001' }).success).toBe(false);
  });

  it('rejects an out-of-range rate (> 30%)', () => {
    expect(taxRateUpdateSchema.safeParse({ province: 'ON', rate: '50' }).success).toBe(false);
  });

  it('rejects a non-numeric rate', () => {
    expect(taxRateUpdateSchema.safeParse({ province: 'ON', rate: 'abc' }).success).toBe(false);
  });

  it('rejects an invalid province', () => {
    expect(taxRateUpdateSchema.safeParse({ province: 'XX', rate: '13.000' }).success).toBe(false);
  });
});
