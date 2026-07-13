import { describe, expect, it } from 'vitest';
import { smsEligibility } from './eligibility';

// D3 fixed CASL windows: purchase/contract → 24 months, inquiry → 6 months,
// express → never lapses. Opt-out beats everything. All cases evaluated
// against a pinned `now` so the matrix is deterministic.

const NOW = new Date('2026-07-13T12:00:00.000Z');

describe('smsEligibility (0103 D3 CASL windows)', () => {
  it('opt-out excludes even express consent (STOP is permanent)', () => {
    expect(
      smsEligibility({
        consentBasis: 'express',
        lastContactAt: '2026-07-01',
        optedOut: true,
        now: NOW,
      }),
    ).toEqual({ eligible: false, reason: 'opted_out' });
  });

  it('express consent never lapses, even with no last-contact date', () => {
    expect(
      smsEligibility({
        consentBasis: 'express',
        lastContactAt: null,
        optedOut: false,
        now: NOW,
      }),
    ).toEqual({ eligible: true });
    expect(
      smsEligibility({
        consentBasis: 'express',
        lastContactAt: '2019-01-01',
        optedOut: false,
        now: NOW,
      }),
    ).toEqual({ eligible: true });
  });

  it('implied purchase is eligible inside 24 months', () => {
    expect(
      smsEligibility({
        consentBasis: 'implied_purchase',
        lastContactAt: '2024-08-01', // ~23.5 months before NOW
        optedOut: false,
        now: NOW,
      }),
    ).toEqual({ eligible: true });
  });

  it('implied purchase lapses past 24 months', () => {
    expect(
      smsEligibility({
        consentBasis: 'implied_purchase',
        lastContactAt: '2024-06-13', // 24 months + 1 month before NOW
        optedOut: false,
        now: NOW,
      }),
    ).toEqual({ eligible: false, reason: 'stale_consent' });
  });

  it('the purchase window closes at end-of-day + 24 months (boundary)', () => {
    // last contact 2024-07-13 → window closes start of 2026-07-14 UTC.
    const justInside = new Date('2026-07-13T23:59:59.000Z');
    const justOutside = new Date('2026-07-14T00:00:00.000Z');
    const base = {
      consentBasis: 'implied_purchase' as const,
      lastContactAt: '2024-07-13',
      optedOut: false,
    };
    expect(smsEligibility({ ...base, now: justInside })).toEqual({ eligible: true });
    expect(smsEligibility({ ...base, now: justOutside })).toEqual({
      eligible: false,
      reason: 'stale_consent',
    });
  });

  it('implied inquiry is eligible inside 6 months and lapses after', () => {
    const base = { consentBasis: 'implied_inquiry' as const, optedOut: false, now: NOW };
    expect(smsEligibility({ ...base, lastContactAt: '2026-02-01' })).toEqual({
      eligible: true,
    });
    expect(smsEligibility({ ...base, lastContactAt: '2025-12-01' })).toEqual({
      eligible: false,
      reason: 'stale_consent',
    });
  });

  it('an implied basis with NO last-contact date is stale (cannot prove a live window)', () => {
    for (const consentBasis of ['implied_purchase', 'implied_inquiry'] as const) {
      expect(
        smsEligibility({ consentBasis, lastContactAt: null, optedOut: false, now: NOW }),
      ).toEqual({ eligible: false, reason: 'stale_consent' });
    }
  });
});
