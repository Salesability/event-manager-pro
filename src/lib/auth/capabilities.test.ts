import { describe, expect, it } from 'vitest';
import {
  can,
  type Capability,
  type CapabilityProfile,
  type CoachAvailabilityResource,
} from './capabilities';

const adminUser = { id: 'u-admin', app_metadata: { role: 'admin' } } as never;
const coachUser = { id: 'u-coach', app_metadata: {} } as never;
const staffUser = { id: 'u-staff', app_metadata: {} } as never;
const viewerUser = { id: 'u-viewer', app_metadata: {} } as never;
const dealerUser = { id: 'u-dealer', app_metadata: {} } as never;
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
const staffProfile: CapabilityProfile = {
  user: staffUser,
  roles: ['staff'],
  coachContactId: null,
};
const viewerProfile: CapabilityProfile = {
  user: viewerUser,
  roles: ['viewer'],
  coachContactId: null,
};
const dealerProfile: CapabilityProfile = {
  user: dealerUser,
  roles: ['dealer'],
  coachContactId: null,
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

  describe('app:access (0036 — STAFF_APP_ROLES admit-set)', () => {
    it('grants admin', () => {
      expect(can(adminProfile, 'app:access')).toBe(true);
    });
    it('grants staff', () => {
      expect(can(staffProfile, 'app:access')).toBe(true);
    });
    it('grants coach', () => {
      expect(can(coachProfile, 'app:access')).toBe(true);
    });
    it('grants viewer', () => {
      expect(can(viewerProfile, 'app:access')).toBe(true);
    });
    it('denies dealer', () => {
      expect(can(dealerProfile, 'app:access')).toBe(false);
    });
    it('denies orphan', () => {
      expect(can(orphanProfile, 'app:access')).toBe(false);
    });
    it('denies unauth (null profile)', () => {
      expect(can(null, 'app:access')).toBe(false);
    });
  });

  describe('admin:access (0036 — admin only)', () => {
    it('grants admin', () => {
      expect(can(adminProfile, 'admin:access')).toBe(true);
    });
    it('denies staff', () => {
      expect(can(staffProfile, 'admin:access')).toBe(false);
    });
    it('denies coach', () => {
      expect(can(coachProfile, 'admin:access')).toBe(false);
    });
    it('denies viewer', () => {
      expect(can(viewerProfile, 'admin:access')).toBe(false);
    });
    it('denies dealer', () => {
      expect(can(dealerProfile, 'admin:access')).toBe(false);
    });
    it('denies orphan', () => {
      expect(can(orphanProfile, 'admin:access')).toBe(false);
    });
    it('denies unauth (null profile)', () => {
      expect(can(null, 'admin:access')).toBe(false);
    });
  });

  describe('reports:view (0036 — admin || coach)', () => {
    it('grants admin', () => {
      expect(can(adminProfile, 'reports:view')).toBe(true);
    });
    it('grants coach', () => {
      expect(can(coachProfile, 'reports:view')).toBe(true);
    });
    it('denies staff', () => {
      expect(can(staffProfile, 'reports:view')).toBe(false);
    });
    it('denies viewer', () => {
      expect(can(viewerProfile, 'reports:view')).toBe(false);
    });
    it('denies dealer', () => {
      expect(can(dealerProfile, 'reports:view')).toBe(false);
    });
    it('denies orphan', () => {
      expect(can(orphanProfile, 'reports:view')).toBe(false);
    });
    it('denies unauth (null profile)', () => {
      expect(can(null, 'reports:view')).toBe(false);
    });
  });

  describe('availability:edit (0036 — admin || coach)', () => {
    it('grants admin', () => {
      expect(can(adminProfile, 'availability:edit')).toBe(true);
    });
    it('grants coach', () => {
      expect(can(coachProfile, 'availability:edit')).toBe(true);
    });
    it('denies staff', () => {
      expect(can(staffProfile, 'availability:edit')).toBe(false);
    });
    it('denies viewer', () => {
      expect(can(viewerProfile, 'availability:edit')).toBe(false);
    });
    it('denies dealer', () => {
      expect(can(dealerProfile, 'availability:edit')).toBe(false);
    });
    it('denies orphan', () => {
      expect(can(orphanProfile, 'availability:edit')).toBe(false);
    });
    it('denies unauth (null profile)', () => {
      expect(can(null, 'availability:edit')).toBe(false);
    });
  });

  describe('msa:edit (0041 — admin || coach)', () => {
    it('grants admin', () => {
      expect(can(adminProfile, 'msa:edit')).toBe(true);
    });
    it('grants coach', () => {
      expect(can(coachProfile, 'msa:edit')).toBe(true);
    });
    it('denies staff', () => {
      expect(can(staffProfile, 'msa:edit')).toBe(false);
    });
    it('denies viewer', () => {
      expect(can(viewerProfile, 'msa:edit')).toBe(false);
    });
    it('denies dealer', () => {
      expect(can(dealerProfile, 'msa:edit')).toBe(false);
    });
    it('denies orphan', () => {
      expect(can(orphanProfile, 'msa:edit')).toBe(false);
    });
    it('denies unauth (null profile)', () => {
      expect(can(null, 'msa:edit')).toBe(false);
    });
  });

  describe('msa:read (0041 — admin || coach || viewer)', () => {
    it('grants admin', () => {
      expect(can(adminProfile, 'msa:read')).toBe(true);
    });
    it('grants coach', () => {
      expect(can(coachProfile, 'msa:read')).toBe(true);
    });
    it('grants viewer', () => {
      expect(can(viewerProfile, 'msa:read')).toBe(true);
    });
    it('denies staff', () => {
      expect(can(staffProfile, 'msa:read')).toBe(false);
    });
    it('denies dealer', () => {
      expect(can(dealerProfile, 'msa:read')).toBe(false);
    });
    it('denies orphan', () => {
      expect(can(orphanProfile, 'msa:read')).toBe(false);
    });
    it('denies unauth (null profile)', () => {
      expect(can(null, 'msa:read')).toBe(false);
    });
  });

  // Hybrid-role profiles. The team_member_roles schema only enforces
  // (contactId, role) uniqueness — nothing forbids a contact from holding
  // multiple roles. The Person dialog exposes Admin / Coach / Dealer as
  // independent checkboxes, so `['coach', 'dealer']` is reachable in
  // practice. Pin the documented "any matching role wins" contract.
  describe('hybrid-role profiles (0036 — multi-role admit-set)', () => {
    const coachAndDealer: CapabilityProfile = {
      user: { id: 'u-cd', app_metadata: {} } as never,
      roles: ['coach', 'dealer'],
      coachContactId: 11,
    };
    const staffAndDealer: CapabilityProfile = {
      user: { id: 'u-sd', app_metadata: {} } as never,
      roles: ['staff', 'dealer'],
      coachContactId: null,
    };
    const viewerAndDealer: CapabilityProfile = {
      user: { id: 'u-vd', app_metadata: {} } as never,
      roles: ['viewer', 'dealer'],
      coachContactId: null,
    };

    it('coach+dealer grants reports:view (coach role wins over dealer tag)', () => {
      expect(can(coachAndDealer, 'reports:view')).toBe(true);
    });
    it('coach+dealer grants availability:edit', () => {
      expect(can(coachAndDealer, 'availability:edit')).toBe(true);
    });
    it('coach+dealer grants app:access', () => {
      expect(can(coachAndDealer, 'app:access')).toBe(true);
    });
    it('coach+dealer denies admin:access', () => {
      expect(can(coachAndDealer, 'admin:access')).toBe(false);
    });
    it('staff+dealer grants app:access (staff role wins over dealer tag)', () => {
      expect(can(staffAndDealer, 'app:access')).toBe(true);
    });
    it('staff+dealer denies reports:view (staff is not coach)', () => {
      expect(can(staffAndDealer, 'reports:view')).toBe(false);
    });
    it('viewer+dealer grants app:access', () => {
      expect(can(viewerAndDealer, 'app:access')).toBe(true);
    });
    it('viewer+dealer denies availability:edit', () => {
      expect(can(viewerAndDealer, 'availability:edit')).toBe(false);
    });
  });
});
