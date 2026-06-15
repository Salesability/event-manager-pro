import type { Msa } from './queries';

// The quote page's MSA-aware send state. Derived from the dealer's current MSA
// (loadActiveOrPendingMsa) without re-encoding the lifecycle rules client-side.
// 0082 reduced this to just the MSA-active standing — the MSA is now sent for
// signature from the dealer page (not bundled with the quote), the bundle CTA is
// gone, and the re-send-in-flight gate was removed. `active` drives both the
// "MSA active — expires …" indicator and the quote accept gate (D3).
export type QuoteMsaState = {
  active: boolean;
  /** Active MSA expiry, for the indicator. Null unless `active`. */
  expiresAt: Date | null;
};

export function deriveQuoteMsaState(msa: Msa | null): QuoteMsaState {
  const active = msa?.status === 'active';
  return {
    active,
    expiresAt: active ? msa!.expiresAt : null,
  };
}
