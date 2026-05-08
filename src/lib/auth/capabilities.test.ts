import { describe, expect, it } from 'vitest';
import {
  can,
  type Capability,
  type CapabilityProfile,
  type CoachAvailabilityResource,
} from './capabilities';

const adminUser = { id: 'u-admin', app_metadata: { role: 'admin' } } as never;
const coachUser = { id: 'u-coach', app_metadata: {} } as never;
const orphanUser = { id: 'u-orphan', app_metadata: {} } as never;

const adminProfile: CapabilityProfile = {
  user: adminUser,
  roles: ['admin'],
  coachContactId: null,
};
const coachProfile: CapabilityProfile = {
  user: coachUser,
  roles: ['coach'],
  coachContactId: 7,
};
const orphanProfile: CapabilityProfile = {
  user: orphanUser,
  roles: [],
  coachContactId: null,
};

const ADMIN_ONLY_CAPS: Capability[] = [
  'production:view',
  'production:export',
  'dealer:view',
  'dealer:edit',
  'dealer:create',
  'dealer:archive',
  'person:view',
  'person:create',
  'person:edit',
  'person:archive',
  'person:adopt-orphan',
  'lookup:edit',
  'campaign:create',
  'campaign:edit',
  'campaign:cancel',
  'email:send',
  'coach-availability:edit-any',
];

describe('can', () => {
  it('returns false for a null profile (deny by default)', () => {
    expect(can(null, 'dealer:edit')).toBe(false);
  });

  it('returns false for a profile with no user', () => {
    expect(
      can({ user: null, roles: [], coachContactId: null }, 'dealer:edit'),
    ).toBe(false);
  });

  describe('admin profile', () => {
    for (const cap of ADMIN_ONLY_CAPS) {
      it(`grants ${cap}`, () => {
        expect(can(adminProfile, cap)).toBe(true);
      });
    }

    it('grants coach-availability:edit-own without resource (admin shortcut)', () => {
      expect(can(adminProfile, 'coach-availability:edit-own')).toBe(true);
    });

    it('grants admin via JWT app_metadata even when roles is empty', () => {
      const jwtAdmin: CapabilityProfile = {
        user: adminUser,
        roles: [],
        coachContactId: null,
      };
      expect(can(jwtAdmin, 'dealer:archive')).toBe(true);
    });
  });

  describe('coach profile', () => {
    for (const cap of ADMIN_ONLY_CAPS) {
      it(`denies ${cap}`, () => {
        expect(can(coachProfile, cap)).toBe(false);
      });
    }

    it('grants coach-availability:edit-own when coach_unavailable row matches own coachId', () => {
      const ownRow: CoachAvailabilityResource = {
        kind: 'coach_unavailable',
        coachId: 7,
      };
      expect(can(coachProfile, 'coach-availability:edit-own', ownRow)).toBe(true);
    });

    it('denies coach-availability:edit-own for another coach\'s row', () => {
      const otherRow: CoachAvailabilityResource = {
        kind: 'coach_unavailable',
        coachId: 8,
      };
      expect(can(coachProfile, 'coach-availability:edit-own', otherRow)).toBe(false);
    });

    it('denies coach-availability:edit-own for non-coach_unavailable kinds', () => {
      const holiday: CoachAvailabilityResource = {
        kind: 'statutory_holiday',
        coachId: null,
      };
      const closure: CoachAvailabilityResource = {
        kind: 'company_closure',
        coachId: null,
      };
      expect(can(coachProfile, 'coach-availability:edit-own', holiday)).toBe(false);
      expect(can(coachProfile, 'coach-availability:edit-own', closure)).toBe(false);
    });

    it('denies coach-availability:edit-own when no resource is provided', () => {
      expect(can(coachProfile, 'coach-availability:edit-own')).toBe(false);
    });
  });

  describe('orphan profile (no roles, no JWT admin)', () => {
    for (const cap of ADMIN_ONLY_CAPS) {
      it(`denies ${cap}`, () => {
        expect(can(orphanProfile, cap)).toBe(false);
      });
    }

    it('denies coach-availability:edit-own even on a matching kind', () => {
      const row: CoachAvailabilityResource = {
        kind: 'coach_unavailable',
        coachId: 7,
      };
      expect(can(orphanProfile, 'coach-availability:edit-own', row)).toBe(false);
    });
  });
});
