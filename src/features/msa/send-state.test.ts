import { describe, expect, it } from 'vitest';
import { deriveQuoteMsaState } from './send-state';
import type { Msa, MsaStatus } from './queries';

// Minimal Msa factory — deriveQuoteMsaState only reads status / expiresAt /
// providerDocumentId; the rest are filled to satisfy the read-model type.
function makeMsa(overrides: Partial<Msa> & { status: MsaStatus }): Msa {
  return {
    id: 1,
    dealerId: 7,
    signedAt: null,
    expiresAt: null,
    signedPdfStorageKey: null,
    providerDocumentId: null,
    terminationNoticeDate: null,
    terminationEffectiveDate: null,
    templateVersion: '2026-05',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('deriveQuoteMsaState (0082 — MSA-only)', () => {
  it('no MSA → not active, not in-flight', () => {
    expect(deriveQuoteMsaState(null)).toEqual({
      active: false,
      expiresAt: null,
      envelopeInFlight: false,
    });
  });

  it('active MSA → active + expiresAt', () => {
    const expiresAt = new Date('2027-05-29T00:00:00Z');
    expect(deriveQuoteMsaState(makeMsa({ status: 'active', expiresAt }))).toEqual({
      active: true,
      expiresAt,
      envelopeInFlight: false,
    });
  });

  it('expired MSA → not active, not in-flight', () => {
    const state = deriveQuoteMsaState(makeMsa({ status: 'expired' }));
    expect(state.active).toBe(false);
    expect(state.expiresAt).toBeNull();
    expect(state.envelopeInFlight).toBe(false);
  });

  it('terminated MSA → not active', () => {
    expect(deriveQuoteMsaState(makeMsa({ status: 'terminated' })).active).toBe(false);
  });

  it('pending MSA with a posted envelope → envelopeInFlight', () => {
    const state = deriveQuoteMsaState(
      makeMsa({ status: 'pending', providerDocumentId: 'doc_123' }),
    );
    expect(state).toEqual({
      active: false,
      expiresAt: null,
      envelopeInFlight: true,
    });
  });

  it('pending MSA without a posted envelope → no flags', () => {
    const state = deriveQuoteMsaState(makeMsa({ status: 'pending' }));
    expect(state.envelopeInFlight).toBe(false);
    expect(state.active).toBe(false);
  });

  it('active MSA with null expiresAt → active but expiresAt stays null', () => {
    expect(deriveQuoteMsaState(makeMsa({ status: 'active', expiresAt: null })).expiresAt).toBeNull();
  });
});
