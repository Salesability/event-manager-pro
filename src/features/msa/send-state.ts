import type { Msa } from './queries';

// The quote page's MSA-aware send state. Derived from the dealer's current MSA
// (loadActiveOrPendingMsa) without re-encoding the lifecycle rules client-side.
// 0082 dropped `bundleEligible` (the MSA is now sent for signature from the
// dealer page, not bundled with the quote), leaving:
//
//   active           → an "MSA active — expires …" indicator; the dealer's
//                      quotes can be accepted.
//   envelopeInFlight → a pending MSA envelope is awaiting signature; the quote
//                      re-send is gated to match the server (removed in Phase 4).
export type QuoteMsaState = {
  active: boolean;
  /** Active MSA expiry, for the indicator. Null unless `active`. */
  expiresAt: Date | null;
  /** A pending MSA envelope is posted to BoldSign awaiting signature. */
  envelopeInFlight: boolean;
};

export function deriveQuoteMsaState(msa: Msa | null): QuoteMsaState {
  const active = msa?.status === 'active';
  return {
    active,
    expiresAt: active ? msa!.expiresAt : null,
    envelopeInFlight:
      msa != null &&
      msa.status === 'pending' &&
      msa.providerDocumentId != null,
  };
}
