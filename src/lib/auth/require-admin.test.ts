import { describe, expect, it } from 'vitest';
import { isAdmin } from './require-admin';

describe('isAdmin', () => {
  it('returns true when app_metadata.role === "admin"', () => {
    expect(isAdmin({ app_metadata: { role: 'admin' } } as never)).toBe(true);
  });

  it('returns false for any other role string', () => {
    expect(isAdmin({ app_metadata: { role: 'coach' } } as never)).toBe(false);
    expect(isAdmin({ app_metadata: { role: 'staff' } } as never)).toBe(false);
    expect(isAdmin({ app_metadata: {} } as never)).toBe(false);
  });

  it('returns false when user is null', () => {
    expect(isAdmin(null)).toBe(false);
  });

  it('returns false when app_metadata is missing', () => {
    expect(isAdmin({} as never)).toBe(false);
  });
});
