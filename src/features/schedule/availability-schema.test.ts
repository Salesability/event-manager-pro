import { describe, expect, it } from 'vitest';
import { availabilityFormSchema } from './availability-schema';

// 0045 Phase 4 — schema-level smoke for the shared availability schema. The
// action (`createAvailabilityBlock` / `updateAvailabilityBlock`) imports this
// same schema and `safeParse`s the wire FormData against it; the form imports
// it via `zodResolver`.

describe('availabilityFormSchema', () => {
  it('accepts a well-formed company_closure block', () => {
    const result = availabilityFormSchema.safeParse({
      startDate: '2026-05-13',
      endDate: '',
      kind: 'company_closure',
      coachId: '',
      reason: 'Closure',
    });
    expect(result.success).toBe(true);
  });

  it('accepts coach_unavailable with a coach id', () => {
    const result = availabilityFormSchema.safeParse({
      startDate: '2026-05-13',
      kind: 'coach_unavailable',
      coachId: '7',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing startDate via fieldErrors.startDate', () => {
    const result = availabilityFormSchema.safeParse({
      kind: 'company_closure',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.startDate?.length).toBeGreaterThan(0);
    }
  });

  it('rejects a malformed startDate', () => {
    const result = availabilityFormSchema.safeParse({
      startDate: '2026/05/13',
      kind: 'company_closure',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid kind enum', () => {
    const result = availabilityFormSchema.safeParse({
      startDate: '2026-05-13',
      kind: 'bogus',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.kind?.[0]).toBe('Invalid block type.');
    }
  });

  it('rejects a reason longer than 200 characters', () => {
    const result = availabilityFormSchema.safeParse({
      startDate: '2026-05-13',
      kind: 'company_closure',
      reason: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.reason?.[0]).toBe('Reason must be 200 characters or fewer.');
    }
  });
});
