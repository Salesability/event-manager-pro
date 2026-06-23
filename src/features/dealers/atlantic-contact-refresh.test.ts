import { describe, expect, it } from 'vitest';
import type { MappedContact } from './atlantic-import';
import {
  type ExistingContact,
  fuzzySamePerson,
  reconcileDealerContacts,
} from './atlantic-contact-refresh';

const gm = (over: Partial<MappedContact> = {}): MappedContact => ({
  title: 'General Manager',
  firstName: 'Andres',
  lastName: 'Monterrosa',
  email: 'amonterrosa@steeleauto.com',
  ...over,
});
const sm = (over: Partial<MappedContact> = {}): MappedContact => ({
  title: 'Sales Manager',
  firstName: 'Tony',
  lastName: 'Vautour',
  email: 'avautour@steeleauto.com',
  ...over,
});
const link = (over: Partial<ExistingContact> = {}): ExistingContact => ({
  linkId: 1,
  contactId: 10,
  role: 'staff',
  title: null,
  name: 'Andres Monterrosa',
  email: 'amonterrosa@steeleauto.com',
  ...over,
});

describe('reconcileDealerContacts — per-slot disposition', () => {
  it('no-change when an existing contact matches name AND email', () => {
    const [p] = reconcileDealerContacts([gm()], [link()]);
    expect(p.disposition).toBe('no-change');
    expect(p.slot).toBe('GM');
    expect(p.match?.contactId).toBe(10);
  });

  it('update-email when same person, different email', () => {
    const [p] = reconcileDealerContacts([gm({ email: 'andres@acuramoncton.ca' })], [link()]);
    expect(p.disposition).toBe('update-email');
    expect(p.match?.contactId).toBe(10); // updates the existing record, not a new one
  });

  it('add when no existing contact matches', () => {
    const [p] = reconcileDealerContacts([gm()], [link({ name: 'Wendy Bulmer', email: 'wbulmer@x.ca' })]);
    expect(p.disposition).toBe('add');
    expect(p.match).toBeNull();
  });

  it('conflict when an existing shares the BD email but a different name (prod data error)', () => {
    // dgraham@centuryhyundai.ca on prod is "Jayson Pearce"; BD says it is "Don Graham".
    const [p] = reconcileDealerContacts(
      [gm({ firstName: 'Don', lastName: 'Graham', email: 'dgraham@centuryhyundai.ca' })],
      [link({ name: 'Jayson Pearce', email: 'dgraham@centuryhyundai.ca' })],
    );
    expect(p.disposition).toBe('conflict');
    expect(p.match?.name).toBe('Jayson Pearce');
  });

  it('fuzzy spelling variant becomes update (in-place), NOT a duplicate add', () => {
    const [p] = reconcileDealerContacts(
      [gm({ firstName: 'Rick', lastName: 'Millner', email: 'rmillner@bruceautogroup.com' })],
      [link({ name: 'Rick Milner', email: 'rmilner@bruceautogroup.com' })],
    );
    expect(p.disposition).toBe('update');
    expect(p.match?.contactId).toBe(10);
  });
});

describe('reconcileDealerContacts — GM + SM together + leftovers', () => {
  it('keeps GM no-change, adds the SM, and surfaces an unlisted existing contact', () => {
    const plans = reconcileDealerContacts(
      [gm(), sm()],
      [link(), link({ linkId: 2, contactId: 99, name: 'Old Primary', email: 'old@x.ca' })],
    );
    const byDisp = Object.fromEntries(plans.map((p) => [p.slot ?? 'unlisted', p.disposition]));
    expect(byDisp.GM).toBe('no-change');
    expect(byDisp.SM).toBe('add');
    expect(byDisp.unlisted).toBe('existing-unlisted');
    // an existing contact each BD slot claimed is never re-emitted as unlisted
    expect(plans.filter((p) => p.disposition === 'existing-unlisted')).toHaveLength(1);
  });

  it('a person matched by one slot is not double-claimed by another', () => {
    // existing "Tony Vautour" is the SM; GM is a genuine add — Tony must not also leak as unlisted
    const plans = reconcileDealerContacts(
      [gm(), sm()],
      [link({ name: 'Tony Vautour', email: 'avautour@steeleauto.com' })],
    );
    expect(plans.find((p) => p.slot === 'SM')?.disposition).toBe('no-change');
    expect(plans.find((p) => p.slot === 'GM')?.disposition).toBe('add');
    expect(plans.some((p) => p.disposition === 'existing-unlisted')).toBe(false);
  });
});

describe('fuzzySamePerson', () => {
  it('true on a shared email local-part', () => {
    expect(fuzzySamePerson('Michael Currie', 'mcurrie@steeleford.com', 'Mike Currie', 'mcurrie@steeleauto.com')).toBe(true);
  });
  it('true on a close edit distance', () => {
    expect(fuzzySamePerson('Rick Millner', 'a@x', 'Rick Milner', 'b@y')).toBe(true);
    expect(fuzzySamePerson('Dwayne Randell', '', 'Dwayne Randall', '')).toBe(true);
  });
  it('true on same last name + first initial (abbreviation)', () => {
    expect(fuzzySamePerson('Mark Wilkins', '', 'M Wilkins', '')).toBe(true);
    expect(fuzzySamePerson('Matthew Munroe', '', 'Matt Munroe', '')).toBe(true);
  });
  it('false on genuinely different people', () => {
    expect(fuzzySamePerson('Jayson Pearce', 'jpearce@centuryhonda.ca', 'Don Graham', 'dgraham@centuryhyundai.ca')).toBe(false);
    expect(fuzzySamePerson('Andres Monterrosa', '', 'Wendy Bulmer', '')).toBe(false);
  });
  it('false when names are empty (no false-positive on blank)', () => {
    expect(fuzzySamePerson('', '', 'Anyone', '')).toBe(false);
  });
});
