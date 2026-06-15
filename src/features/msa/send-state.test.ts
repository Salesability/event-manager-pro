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
  it('no MSA → not active', () => {
    expect(deriveQuoteMsaState(null)).toEqual({ active: false, expiresAt: null });
  });

  it('active MSA → active + expiresAt', () => {
    const expiresAt = new Date('2027-05-29T00:00:00Z');
    expect(deriveQuoteMsaState(makeMsa({ status: 'active', expiresAt }))).toEqual({
      active: true,
      expiresAt,
    });
  });

  it('expired MSA → not active', () => {
    const state = deriveQuoteMsaState(makeMsa({ status: 'expired' }));
    expect(state.active).toBe(false);
    expect(state.expiresAt).toBeNull();
  });

  it('terminated MSA → not active', () => {
    expect(deriveQuoteMsaState(makeMsa({ status: 'terminated' })).active).toBe(false);
  });

  it('pending MSA → not active (no accept, no indicator)', () => {
    expect(deriveQuoteMsaState(makeMsa({ status: 'pending' }))).toEqual({
      active: false,
      expiresAt: null,
    });
  });

  it('active MSA with null expiresAt → active but expiresAt stays null', () => {
    expect(deriveQuoteMsaState(makeMsa({ status: 'active', expiresAt: null })).expiresAt).toBeNull();
  });
});
