import { describe, expect, it, vi } from 'vitest';

// `commercial-status.ts` is `server-only`; stub the guard so the test can import
// its pure `isExposed` predicate for building self-consistent fixtures (matches
// `commercial-status.test.ts`).
vi.mock('server-only', () => ({}));

import type { CommercialStatus } from './commercial-status';
import { isExposed } from './commercial-status';
import { nextCommercialStep } from './next-step';

// Build a CommercialStatus with a self-consistent `exposed` flag (derived the
// same way the loader does) so the tests exercise realistic inputs.
function status(over: Partial<CommercialStatus>): CommercialStatus {
  const quoteStatus = over.quoteStatus ?? null;
  const msaStatus = over.msaStatus ?? null;
  const msaWaived = over.msaWaived ?? false;
  return {
    quoteStatus,
    quoteId: over.quoteId ?? null,
    msaStatus,
    msaWaived,
    exposed: over.exposed ?? isExposed(quoteStatus, msaStatus, msaWaived),
  };
}

describe('nextCommercialStep', () => {
  it('returns null for a cancelled event regardless of commercial state', () => {
    expect(nextCommercialStep('cancelled', status({ quoteId: null }))).toBeNull();
  });

  it('returns null when there is no commercial status', () => {
    expect(nextCommercialStep('booked', undefined)).toBeNull();
  });

  it('returns null when the event is protected (accepted quote + active MSA)', () => {
    const s = status({ quoteStatus: 'accepted', quoteId: 5, msaStatus: 'active' });
    expect(s.exposed).toBe(false);
    expect(nextCommercialStep('booked', s)).toBeNull();
  });

  it('returns null when protected via a waived MSA', () => {
    const s = status({ quoteStatus: 'accepted', quoteId: 5, msaWaived: true });
    expect(s.exposed).toBe(false);
    expect(nextCommercialStep('booked', s)).toBeNull();
  });

  it('create-quote when the event has no quote yet', () => {
    expect(nextCommercialStep('booked', status({ quoteId: null }))).toBe('create-quote');
  });

  it('edit-quote when a draft quote exists', () => {
    expect(
      nextCommercialStep('booked', status({ quoteStatus: 'draft', quoteId: 7 })),
    ).toBe('edit-quote');
  });

  it('send-msa when a sent quote has no MSA', () => {
    expect(
      nextCommercialStep('booked', status({ quoteStatus: 'sent', quoteId: 7 })),
    ).toBe('send-msa');
  });

  it('send-msa when the MSA is only pending (not active)', () => {
    expect(
      nextCommercialStep('booked', status({ quoteStatus: 'sent', quoteId: 7, msaStatus: 'pending' })),
    ).toBe('send-msa');
  });

  it('send-msa when a quote is accepted but the MSA is still missing', () => {
    // Accepted quote with no MSA is still exposed — the MSA is the next step.
    const s = status({ quoteStatus: 'accepted', quoteId: 7 });
    expect(s.exposed).toBe(true);
    expect(nextCommercialStep('booked', s)).toBe('send-msa');
  });

  it('accept-quote when a sent quote is waiting and the MSA is active', () => {
    expect(
      nextCommercialStep('booked', status({ quoteStatus: 'sent', quoteId: 7, msaStatus: 'active' })),
    ).toBe('accept-quote');
  });

  it('accept-quote when a sent quote is waiting and the MSA is waived', () => {
    expect(
      nextCommercialStep('booked', status({ quoteStatus: 'sent', quoteId: 7, msaWaived: true })),
    ).toBe('accept-quote');
  });

  it('null for a declined quote once the MSA is already in place (no obvious next step)', () => {
    expect(
      nextCommercialStep('booked', status({ quoteStatus: 'declined', quoteId: 7, msaStatus: 'active' })),
    ).toBeNull();
  });

  it('send-msa for an expired quote that still lacks an MSA', () => {
    expect(
      nextCommercialStep('booked', status({ quoteStatus: 'expired', quoteId: 7 })),
    ).toBe('send-msa');
  });
});
