import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  effectiveMsaStatus,
  isExposed,
  msaDisplayState,
  quoteDisplayStatus,
} from './commercial-status';

describe('isExposed', () => {
  // Protected = accepted quote AND active MSA. Everything else is exposed.
  it('is NOT exposed only when quote=accepted and MSA=active', () => {
    expect(isExposed('accepted', 'active')).toBe(false);
  });

  it('is exposed when the quote is accepted but the MSA is not active', () => {
    expect(isExposed('accepted', 'pending')).toBe(true);
    expect(isExposed('accepted', null)).toBe(true);
  });

  it('is exposed when the MSA is active but the quote is not accepted', () => {
    expect(isExposed('draft', 'active')).toBe(true);
    expect(isExposed('sent', 'active')).toBe(true);
    expect(isExposed('expired', 'active')).toBe(true);
    expect(isExposed('declined', 'active')).toBe(true);
    expect(isExposed(null, 'active')).toBe(true);
  });

  it('is exposed when both are missing (a bare booked date)', () => {
    expect(isExposed(null, null)).toBe(true);
  });

  // 0100: a waived event (campaigns.msa_waived) satisfies the MSA dimension
  // without an active MSA. The quote dimension is untouched.
  it('is NOT exposed when the quote is accepted and the event is waived, even with no active MSA', () => {
    expect(isExposed('accepted', null, true)).toBe(false);
    expect(isExposed('accepted', 'pending', true)).toBe(false);
    expect(isExposed('accepted', 'expired', true)).toBe(false);
  });

  it('stays NOT exposed when waived AND the MSA is active (both satisfy the MSA side)', () => {
    expect(isExposed('accepted', 'active', true)).toBe(false);
  });

  it('is STILL exposed on a waived event whose quote is not accepted (quote dimension untouched)', () => {
    expect(isExposed('sent', null, true)).toBe(true);
    expect(isExposed('draft', 'pending', true)).toBe(true);
    expect(isExposed(null, null, true)).toBe(true);
  });

  it('regression: a non-waived event is unchanged (waiver defaults false)', () => {
    expect(isExposed('accepted', 'active', false)).toBe(false);
    expect(isExposed('accepted', null, false)).toBe(true);
    expect(isExposed('accepted', 'pending', false)).toBe(true);
    // Omitting the arg matches the false default (no behavioural change to callers).
    expect(isExposed('accepted', null)).toBe(true);
  });
});

describe('effectiveMsaStatus (matches the accept gate: active only while unexpired)', () => {
  const NOW = 1_000_000_000_000;
  const future = new Date(NOW + 86_400_000);
  const past = new Date(NOW - 86_400_000);

  it('reports a non-expired active MSA as active', () => {
    expect(effectiveMsaStatus([{ status: 'active', expiresAt: future }], NOW)).toBe('active');
  });

  it('treats a null expiresAt as not-expired (active)', () => {
    expect(effectiveMsaStatus([{ status: 'active', expiresAt: null }], NOW)).toBe('active');
  });

  it('downgrades an active-but-expired MSA to expired (so it is NOT protected)', () => {
    expect(effectiveMsaStatus([{ status: 'active', expiresAt: past }], NOW)).toBe('expired');
  });

  it('prefers a valid active over an expired-active or pending', () => {
    expect(
      effectiveMsaStatus(
        [
          { status: 'active', expiresAt: past },
          { status: 'pending', expiresAt: null },
          { status: 'active', expiresAt: future },
        ],
        NOW,
      ),
    ).toBe('active');
  });

  it('expired-active outranks pending', () => {
    expect(
      effectiveMsaStatus(
        [
          { status: 'pending', expiresAt: null },
          { status: 'active', expiresAt: past },
        ],
        NOW,
      ),
    ).toBe('expired');
  });

  it('reports pending when that is all there is, and null when empty', () => {
    expect(effectiveMsaStatus([{ status: 'pending', expiresAt: null }], NOW)).toBe('pending');
    expect(effectiveMsaStatus([], NOW)).toBeNull();
  });
});

describe('msaDisplayState (0100 waiver)', () => {
  it('reads a waived event as "waived" regardless of the dealer MSA standing', () => {
    expect(msaDisplayState({ msaStatus: null, msaWaived: true })).toBe('waived');
    expect(msaDisplayState({ msaStatus: 'active', msaWaived: true })).toBe('waived');
    expect(msaDisplayState({ msaStatus: 'pending', msaWaived: true })).toBe('waived');
  });

  it('passes the dealer MSA standing through unchanged when not waived', () => {
    expect(msaDisplayState({ msaStatus: 'active', msaWaived: false })).toBe('active');
    expect(msaDisplayState({ msaStatus: 'pending', msaWaived: false })).toBe('pending');
    expect(msaDisplayState({ msaStatus: null, msaWaived: false })).toBeNull();
  });
});

describe('quoteDisplayStatus', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it('passes through non-sent statuses unchanged', () => {
    expect(quoteDisplayStatus({ status: 'draft', sentAt: null, quoteValidDays: 30 })).toBe('draft');
    expect(quoteDisplayStatus({ status: 'accepted', sentAt: daysAgo(99), quoteValidDays: 30 })).toBe(
      'accepted',
    );
    expect(quoteDisplayStatus({ status: 'declined', sentAt: daysAgo(99), quoteValidDays: 30 })).toBe(
      'declined',
    );
  });

  it('keeps a sent quote inside its validity window as sent', () => {
    expect(quoteDisplayStatus({ status: 'sent', sentAt: daysAgo(10), quoteValidDays: 30 })).toBe(
      'sent',
    );
  });

  it('derives expired when a sent quote is past sentAt + quoteValidDays', () => {
    expect(quoteDisplayStatus({ status: 'sent', sentAt: daysAgo(31), quoteValidDays: 30 })).toBe(
      'expired',
    );
  });

  it('never expires a sent quote with no sentAt', () => {
    expect(quoteDisplayStatus({ status: 'sent', sentAt: null, quoteValidDays: 30 })).toBe('sent');
  });
});
