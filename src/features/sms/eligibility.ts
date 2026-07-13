// Pure CASL send-eligibility predicate (0103 D3). No DB, no Date.now() — the
// caller supplies `now` and the opt-out fact, so the window logic is
// unit-testable in isolation (same shape rationale as
// `src/features/quotes/accept-gate.ts`, minus the executor: this one needs no
// queries at all).
//
// The windows are CASL's implied-consent defaults, fixed by decision (D3):
// a purchase/contract keeps implied consent alive for 24 months from the last
// dealer↔customer contact; an inquiry for 6 months; express consent never
// lapses. An implied-basis recipient with NO last-contact date cannot prove a
// live window — treated as stale (excluded + reported), not an import error.

export type SmsConsentBasis = 'express' | 'implied_purchase' | 'implied_inquiry';

export type SmsEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'opted_out' | 'stale_consent' };

export const CONSENT_WINDOW_MONTHS: Record<SmsConsentBasis, number | null> = {
  express: null, // no expiry
  implied_purchase: 24,
  implied_inquiry: 6,
};

// Month-arithmetic on a UTC calendar (the statute speaks in months/years, not
// days). `lastContactAt` is the DATE column's `YYYY-MM-DD`; the window closes
// at the END of that calendar day + N months, evaluated against `now`.
function windowCloses(lastContactAt: string, months: number): Date {
  const [y, m, d] = lastContactAt.split('-').map(Number);
  // Day-clamping (e.g. Aug 31 + 6mo) is handled by Date.UTC rollover — the
  // statutory reading is "no later than", so rolling into the next day errs
  // long by hours at most; acceptable against a DATE-granular input.
  return new Date(Date.UTC(y, m - 1 + months, d + 1));
}

export function smsEligibility(input: {
  consentBasis: SmsConsentBasis;
  lastContactAt: string | null;
  optedOut: boolean;
  now: Date;
}): SmsEligibility {
  // Opt-out beats everything, including express consent — STOP is permanent.
  if (input.optedOut) return { eligible: false, reason: 'opted_out' };

  const months = CONSENT_WINDOW_MONTHS[input.consentBasis];
  if (months === null) return { eligible: true };

  if (!input.lastContactAt) return { eligible: false, reason: 'stale_consent' };
  if (input.now >= windowCloses(input.lastContactAt, months)) {
    return { eligible: false, reason: 'stale_consent' };
  }
  return { eligible: true };
}
