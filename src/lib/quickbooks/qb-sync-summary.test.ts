import { describe, expect, it } from 'vitest';
import { decodeQbSyncSummary, encodeQbSyncSummary } from './qb-sync-summary';

describe('combined QB sync summary param encode/decode', () => {
  it('round-trips dealer + item results through the flash param', () => {
    const dealers = { created: 3, linked: 2, skipped: 1 };
    const items = { created: 5, updated: 4, archived: 2, purged: 6 };
    expect(decodeQbSyncSummary(encodeQbSyncSummary(dealers, items))).toEqual({ dealers, items });
  });

  it('round-trips the all-zero (nothing actionable) case', () => {
    const dealers = { created: 0, linked: 0, skipped: 0 };
    const items = { created: 0, updated: 0, archived: 0, purged: 0 };
    const param = encodeQbSyncSummary(dealers, items);
    expect(param).toBe('0.0.0.0.0.0.0');
    expect(decodeQbSyncSummary(param)).toEqual({ dealers, items });
  });

  it('encodes as <c.l.s>.<c.u.a.p> — 7 dot segments', () => {
    expect(
      encodeQbSyncSummary({ created: 1, linked: 0, skipped: 2 }, { created: 3, updated: 0, archived: 4, purged: 5 }),
    ).toBe('1.0.2.3.0.4.5');
  });

  it('rejects malformed params', () => {
    expect(decodeQbSyncSummary('1.2.3')).toBeNull(); // too few (dealer-only)
    expect(decodeQbSyncSummary('1.2.3.4')).toBeNull(); // too few (item-only)
    expect(decodeQbSyncSummary('0.0.0.0.0.0.0.0')).toBeNull(); // too many
    expect(decodeQbSyncSummary('a.b.c.d.e.f.g')).toBeNull(); // non-numeric
    expect(decodeQbSyncSummary('-1.0.0.0.0.0.0')).toBeNull(); // negative
    expect(decodeQbSyncSummary('1e9.0.0.0.0.0.0')).toBeNull(); // exponent notation
    expect(decodeQbSyncSummary('')).toBeNull();
  });
});
