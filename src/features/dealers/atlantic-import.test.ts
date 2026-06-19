import { describe, expect, it } from 'vitest';
import {
  type AtlanticRow,
  ATLANTIC_ACQUIRED_VIA,
  buildDropSet,
  buildNotesBlock,
  dropKey,
  mapRowToContacts,
  mapRowToDealer,
  splitName,
} from './atlantic-import';

const row = (over: Partial<AtlanticRow> = {}): AtlanticRow => ({
  manufacturer: 'Acura',
  dealership: 'Acura of Moncton',
  city: 'Moncton',
  province: 'NB',
  group: '',
  phone: '506-853-1116',
  gm: 'Andres Monterrosa',
  contact1Email: 'amonterrosa@steeleauto.com',
  sm: 'Tony Vautour',
  contact2Email: 'avautour@steeleauto.com',
  coopEligible: '',
  notes: '',
  verification: 'Verified by call',
  ...over,
});

describe('mapRowToDealer', () => {
  it('maps the core dealer fields, city→address, prospect status, batch tag', () => {
    const d = mapRowToDealer(row());
    expect(d.name).toBe('Acura of Moncton');
    expect(d.address).toBe('Moncton'); // city only (D6)
    expect(d.province).toBe('NB');
    expect(d.phone).toBe('506-853-1116');
    expect(d.manufacturer).toBe('Acura');
    expect(d.status).toBe('prospect');
    expect(d.acquiredVia).toBe(ATLANTIC_ACQUIRED_VIA);
  });

  it('nulls an unknown province rather than guessing', () => {
    expect(mapRowToDealer(row({ province: '' })).province).toBeNull();
    expect(mapRowToDealer(row({ province: 'XX' })).province).toBeNull();
    expect(mapRowToDealer(row({ province: 'nl' })).province).toBe('NL'); // case-normalized
  });

  it('nulls empty optional dealer fields', () => {
    const d = mapRowToDealer(row({ phone: '', manufacturer: '', city: '' }));
    expect(d.phone).toBeNull();
    expect(d.manufacturer).toBeNull();
    expect(d.address).toBeNull();
  });
});

describe('buildNotesBlock', () => {
  it('returns null when group/verification/coop/notes are all empty', () => {
    expect(
      buildNotesBlock(row({ group: '', verification: '', coopEligible: '', notes: '' })),
    ).toBeNull();
  });

  it('composes only the non-empty parts, newline-joined, in order', () => {
    const block = buildNotesBlock(
      row({
        group: 'Steele',
        verification: 'Verified by call',
        coopEligible: 'Yes',
        notes: 'Bruce Hill is the official owner',
      }),
    );
    expect(block).toBe(
      'Group: Steele\nVerification: Verified by call\nCo-op eligible: Yes\nBruce Hill is the official owner',
    );
  });

  it('keeps a verification-only block (the common case — every row is verified)', () => {
    expect(buildNotesBlock(row({ group: '', notes: '', verification: 'Confirmed' }))).toBe(
      'Verification: Confirmed',
    );
  });
});

describe('mapRowToContacts', () => {
  it('emits GM + SM with titles and lowercased emails', () => {
    const cs = mapRowToContacts(row());
    expect(cs).toEqual([
      { title: 'General Manager', firstName: 'Andres', lastName: 'Monterrosa', email: 'amonterrosa@steeleauto.com' },
      { title: 'Sales Manager', firstName: 'Tony', lastName: 'Vautour', email: 'avautour@steeleauto.com' },
    ]);
  });

  it('lowercases + trims a messy email', () => {
    expect(mapRowToContacts(row({ contact1Email: '  Jane.DOE@X.CA ', sm: '', contact2Email: '' }))[0].email).toBe(
      'jane.doe@x.ca',
    );
  });

  it('drops an empty SM slot (no name, no email)', () => {
    const cs = mapRowToContacts(row({ sm: '', contact2Email: '' }));
    expect(cs).toHaveLength(1);
    expect(cs[0].title).toBe('General Manager');
  });

  it('keeps a name-only contact with email=null (deduped per dealer/title downstream)', () => {
    const cs = mapRowToContacts(row({ gm: 'Pat Smith', contact1Email: '', sm: '', contact2Email: '' }));
    expect(cs).toEqual([
      { title: 'General Manager', firstName: 'Pat', lastName: 'Smith', email: null },
    ]);
  });

  it('treats a non-@ value as no email', () => {
    expect(mapRowToContacts(row({ contact1Email: 'n/a', sm: '', contact2Email: '' }))[0].email).toBeNull();
  });
});

describe('splitName', () => {
  it('splits first token vs the rest; single token has empty last name', () => {
    expect(splitName('Jamie Campbell')).toEqual({ firstName: 'Jamie', lastName: 'Campbell' });
    expect(splitName('Jean-Luc de la Croix')).toEqual({ firstName: 'Jean-Luc', lastName: 'de la Croix' });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
    expect(splitName('')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('drop-list', () => {
  it('keys case- and whitespace-insensitively on name+city', () => {
    const set = buildDropSet({
      dropList: [{ name: 'Smith & Watt Limited', city: 'Barrington Passage', reason: '' }],
    });
    expect(set.has(dropKey('  smith & watt limited ', 'BARRINGTON PASSAGE'))).toBe(true);
    expect(set.has(dropKey('Smith & Watt Chrysler', 'Shelburne'))).toBe(false);
  });
});
