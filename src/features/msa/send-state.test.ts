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

describe('deriveQuoteMsaState (0061)', () => {
  it('no MSA → bundleEligible, not active, not in-flight', () => {
    expect(deriveQuoteMsaState(null)).toEqual({
      active: false,
      expiresAt: null,
      bundleEligible: true,
      envelopeInFlight: false,
    });
  });

  it('active MSA → active + expiresAt, not bundleEligible', () => {
    const expiresAt = new Date('2027-05-29T00:00:00Z');
    expect(deriveQuoteMsaState(makeMsa({ status: 'active', expiresAt }))).toEqual({
      active: true,
      expiresAt,
      bundleEligible: false,
      envelopeInFlight: false,
    });
  });

  it('expired MSA → bundleEligible (renewal path), not active', () => {
    const state = deriveQuoteMsaState(makeMsa({ status: 'expired' }));
    expect(state.bundleEligible).toBe(true);
    expect(state.active).toBe(false);
    expect(state.expiresAt).toBeNull();
  });

  it('terminated MSA → bundleEligible (renewal path)', () => {
    expect(deriveQuoteMsaState(makeMsa({ status: 'terminated' })).bundleEligible).toBe(
      true,
    );
  });

  it('pending MSA with a posted envelope → envelopeInFlight, not bundleEligible', () => {
    const state = deriveQuoteMsaState(
      makeMsa({ status: 'pending', providerDocumentId: 'doc_123' }),
    );
    expect(state).toEqual({
      active: false,
      expiresAt: null,
      bundleEligible: false,
      envelopeInFlight: true,
    });
  });

  it('pending MSA without a posted envelope → no flags (plain-send fallback)', () => {
    const state = deriveQuoteMsaState(makeMsa({ status: 'pending' }));
    expect(state.bundleEligible).toBe(false);
    expect(state.envelopeInFlight).toBe(false);
    expect(state.active).toBe(false);
  });

  it('active MSA with null expiresAt → active but expiresAt stays null', () => {
    expect(deriveQuoteMsaState(makeMsa({ status: 'active', expiresAt: null })).expiresAt).toBeNull();
  });
});
