import { describe, expect, it } from 'vitest';
import { isAdminPath, isAdminUser } from './middleware';

describe('isAdminPath', () => {
  it('matches the bare /admin root', () => {
    expect(isAdminPath('/admin')).toBe(true);
  });

  it('matches every /admin/* subpath', () => {
    expect(isAdminPath('/admin/users')).toBe(true);
    expect(isAdminPath('/admin/lookups')).toBe(true);
    expect(isAdminPath('/admin/anything/nested')).toBe(true);
  });

  it('does not match non-admin paths', () => {
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/calendar')).toBe(false);
    expect(isAdminPath('/production')).toBe(false);
    expect(isAdminPath('/dealerships')).toBe(false);
    expect(isAdminPath('/share/coach/1')).toBe(false);
  });

  it('does not falsely match a path that merely starts with the substring "admin"', () => {
    expect(isAdminPath('/administrative')).toBe(false);
    expect(isAdminPath('/administer')).toBe(false);
  });
});

describe('isAdminUser', () => {
  it('returns true only for the literal "admin" role', () => {
    expect(isAdminUser('admin')).toBe(true);
  });

  it('returns false for any other role string', () => {
    expect(isAdminUser('coach')).toBe(false);
    expect(isAdminUser('staff')).toBe(false);
    expect(isAdminUser('viewer')).toBe(false);
    expect(isAdminUser('Admin')).toBe(false);
  });

  it('returns false for null / undefined / non-string values (defensive)', () => {
    expect(isAdminUser(undefined)).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(0)).toBe(false);
    expect(isAdminUser({ role: 'admin' })).toBe(false);
    expect(isAdminUser([])).toBe(false);
  });
});
