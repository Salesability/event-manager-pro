import { describe, expect, it } from 'vitest';
import { coachValuesToFormData } from './coach-add-schema';

describe('coachValuesToFormData', () => {
  it('forces roles=coach and appAccess=1 in the wire format', () => {
    const fd = coachValuesToFormData({
      firstName: 'Pat',
      lastName: 'Coach',
      email: 'pat@coach.test',
      phone: '902-555-0100',
    });
    expect(fd.getAll('roles')).toEqual(['coach']);
    expect(fd.get('appAccess')).toBe('1');
    expect(fd.get('firstName')).toBe('Pat');
    expect(fd.get('lastName')).toBe('Coach');
    expect(fd.get('email')).toBe('pat@coach.test');
    expect(fd.get('phone')).toBe('902-555-0100');
  });

  it('sends an empty phone string when phone is omitted', () => {
    const fd = coachValuesToFormData({
      firstName: 'Sam',
      lastName: 'Lee',
      email: 'sam@coach.test',
    });
    expect(fd.get('phone')).toBe('');
    expect(fd.getAll('roles')).toEqual(['coach']);
    expect(fd.get('appAccess')).toBe('1');
  });
});
