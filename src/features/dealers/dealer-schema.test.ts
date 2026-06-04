import { describe, expect, it } from 'vitest';
import { dealerFormSchema } from './dealer-schema';

// 0065 — province validation contract (the form's `zodResolver` and the
// createDealer/updateDealer `safeParse` both run against this schema).

describe('dealerFormSchema province (0065)', () => {
  it('accepts a valid province code', () => {
    const parsed = dealerFormSchema.safeParse({ name: 'Acme', province: 'ON' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.province).toBe('ON');
  });

  it("accepts '' (no province / clear)", () => {
    const parsed = dealerFormSchema.safeParse({ name: 'Acme', province: '' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.province).toBe('');
  });

  it('accepts an omitted province', () => {
    const parsed = dealerFormSchema.safeParse({ name: 'Acme' });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid province code', () => {
    const parsed = dealerFormSchema.safeParse({ name: 'Acme', province: 'XX' });
    expect(parsed.success).toBe(false);
  });
});
