import { describe, expect, it } from 'vitest';
import { safeNextPath } from './url';

describe('safeNextPath', () => {
  it('returns same-origin paths unchanged', () => {
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/events/abc?tab=guests')).toBe('/events/abc?tab=guests');
  });

  it('rejects protocol-relative URLs (open-redirect vector)', () => {
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('//evil.com/path')).toBe('/');
  });

  it('rejects absolute URLs', () => {
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('http://evil.com/path')).toBe('/');
  });

  it('rejects paths that do not start with a slash', () => {
    expect(safeNextPath('dashboard')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });

  it('coerces non-strings (FormData / searchParams edge cases) to "/"', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(42)).toBe('/');
    expect(safeNextPath(new File([], 'x'))).toBe('/');
  });
});
