import { describe, expect, it } from 'vitest';
import { isAdminPath, isAdminUser, isPublicPath } from './middleware';

describe('isPublicPath', () => {
  it('treats the BoldSign webhook as public (external HMAC-gated caller, no session cookie)', () => {
    // Regression: without this the auth gate 307-redirects BoldSign's POST to
    // /login and the signed-envelope webhook never reaches its handler.
    expect(isPublicPath('/api/boldsign/webhook')).toBe(true);
  });

  it('treats the Twilio webhook as public (signature-gated in-handler, no session cookie)', () => {
    // Regression: without this every Twilio status callback and inbound SMS
    // (replies, STOP) 307-redirects to /login and is silently dropped.
    expect(isPublicPath('/api/twilio/webhook')).toBe(true);
  });

  it('matches the other public paths and their subpaths', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
    expect(isPublicPath('/auth/auth-error')).toBe(true);
    expect(isPublicPath('/share/coach/abc123')).toBe(true);
  });

  it('does not treat gated app paths as public', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/calendar')).toBe(false);
    expect(isPublicPath('/reports/export')).toBe(false);
    expect(isPublicPath('/production/export')).toBe(false);
  });
});

describe('isAdminPath', () => {
  it('matches the bare /admin root', () => {
    expect(isAdminPath('/admin')).toBe(true);
  });

  it('matches every /admin/* subpath', () => {
    expect(isAdminPath('/admin/users')).toBe(true);
    expect(isAdminPath('/admin/lookups')).toBe(true);
    expect(isAdminPath('/admin/anything/nested')).toBe(true);
  });

  it('matches /production and /dealerships and their subpaths (admin-only after 0028)', () => {
    expect(isAdminPath('/production')).toBe(true);
    expect(isAdminPath('/production/export')).toBe(true);
    expect(isAdminPath('/dealerships')).toBe(true);
    expect(isAdminPath('/dealerships/anything')).toBe(true);
  });

  it('does not match non-admin paths', () => {
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/calendar')).toBe(false);
    expect(isAdminPath('/reports')).toBe(false);
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
