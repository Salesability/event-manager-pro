import type { Msa } from './queries';

// The quote composer's MSA-aware send state (0061). Derived from the dealer's
// current MSA (loadActiveOrPendingMsa) so the toolbar picks exactly one
// affordance per state without re-encoding the lifecycle rules client-side:
//
//   bundleEligible   → "Send for signature" is the primary CTA (the signed
//                      MSA+Quote bundle); plain "Send Quote" demotes to outline.
//   active           → plain "Send Quote" + an "MSA active — expires …" note.
//   envelopeInFlight → a bundled envelope is awaiting signature (disabled).
//
// The states are mutually exclusive given loadActiveOrPendingMsa's contract
// (returns the active MSA if any, else the most-recent pending). A pending row
// whose envelope hasn't been posted yet (no providerDocumentId) maps to none
// of the flags → the toolbar falls back to plain send (rare; owned by the
// 0041 resend-envelope follow-up).
export type QuoteMsaState = {
  active: boolean;
  /** Active MSA expiry, for the indicator. Null unless `active`. */
  expiresAt: Date | null;
  /** No usable MSA — none, expired, or terminated. Exactly the states where
   *  `createMsaDraft` won't collide with a pending/active row. */
  bundleEligible: boolean;
  /** A bundled envelope is posted to BoldSign awaiting signature. */
  envelopeInFlight: boolean;
};

export function deriveQuoteMsaState(msa: Msa | null): QuoteMsaState {
  const active = msa?.status === 'active';
  return {
    active,
    expiresAt: active ? msa!.expiresAt : null,
    bundleEligible:
      msa == null || msa.status === 'expired' || msa.status === 'terminated',
    envelopeInFlight:
      msa != null &&
      msa.status === 'pending' &&
      msa.providerDocumentId != null,
  };
}
