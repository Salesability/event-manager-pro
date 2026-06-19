import { describe, expect, it } from 'vitest';
import { toLegacyResult } from './legacy-result';

describe('toLegacyResult', () => {
  it('passes an { ok: true } success payload through with extra fields', () => {
    expect(toLegacyResult({ data: { ok: true, dealerId: 5 } })).toEqual({ ok: true, dealerId: 5 });
  });

  // 0085 — the duplicate-detected result must survive the adapter so the form
  // can render the reuse/link affordance.
  it('passes a { duplicate } payload through', () => {
    const data = {
      duplicate: { kind: 'dealer-local' as const, dealerId: 5, name: 'ABC Motors', address: null },
    };
    expect(toLegacyResult({ data })).toEqual(data);
  });

  it('maps a string error payload to { error }', () => {
    expect(toLegacyResult({ data: { error: 'Bad input.' } })).toEqual({ error: 'Bad input.' });
  });

  it('maps a serverError to { error }', () => {
    expect(toLegacyResult({ serverError: 'boom' })).toEqual({ error: 'boom' });
  });

  it('returns a no-response error for a null result', () => {
    expect(toLegacyResult(null)).toEqual({ error: 'No response from server.' });
  });
});
