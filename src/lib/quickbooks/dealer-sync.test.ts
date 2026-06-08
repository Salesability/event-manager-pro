import { describe, expect, it, vi } from 'vitest';
import {
  classifyDealerSyncPlan,
  decodeSyncSummary,
  encodeSyncSummary,
  type ExistingDealer,
  mapCustomerToDealer,
} from './dealer-sync';
import type { QboCustomer } from './client';

// `dealer-sync` imports `@/lib/db` for the default executor; stub it so the
// module loads without constructing a real Postgres pool. The functions under
// test here are pure (no DB), so an empty stub is enough.
vi.mock('@/lib/db', () => ({ db: {} }));

describe('mapCustomerToDealer', () => {
  it('uses CompanyName, normalizes a 2-letter province, formats the billing address', () => {
    const c: QboCustomer = {
      Id: '1',
      CompanyName: 'Acme Motors',
      DisplayName: 'Acme Motors (display)',
      BillAddr: { Line1: '123 King St', City: 'Toronto', CountrySubDivisionCode: 'ON', PostalCode: 'M5V 1A1' },
    };
    expect(mapCustomerToDealer(c)).toEqual({
      qbId: '1',
      name: 'Acme Motors',
      address: '123 King St, Toronto ON M5V 1A1',
      province: 'ON',
      isJob: false,
    });
  });

  it('falls back to DisplayName when CompanyName is absent', () => {
    const c: QboCustomer = { Id: '5', DisplayName: 'Jane Doe' };
    expect(mapCustomerToDealer(c).name).toBe('Jane Doe');
  });

  it('normalizes province aliases and full names', () => {
    const pei = mapCustomerToDealer({ Id: '2', CompanyName: 'X', BillAddr: { CountrySubDivisionCode: 'PEI' } });
    const quebec = mapCustomerToDealer({ Id: '3', CompanyName: 'Y', BillAddr: { CountrySubDivisionCode: 'Quebec' } });
    const pq = mapCustomerToDealer({ Id: '4', CompanyName: 'Z', BillAddr: { CountrySubDivisionCode: 'PQ' } });
    expect([pei.province, quebec.province, pq.province]).toEqual(['PE', 'QC', 'QC']);
  });

  it('maps a non-CA subdivision to null province', () => {
    expect(mapCustomerToDealer({ Id: '6', CompanyName: 'US Co', BillAddr: { CountrySubDivisionCode: 'NY' } }).province).toBeNull();
  });

  it('falls through to the shipping address + province when billing is absent', () => {
    const c: QboCustomer = { Id: '7', CompanyName: 'Ship Co', ShipAddr: { Line1: '9 Bay', CountrySubDivisionCode: 'AB' } };
    const m = mapCustomerToDealer(c);
    expect(m.address).toBe('9 Bay, AB');
    expect(m.province).toBe('AB');
  });

  it('flags Job sub-customers and ParentRef records', () => {
    expect(mapCustomerToDealer({ Id: '8', CompanyName: 'Sub', Job: true }).isJob).toBe(true);
    expect(mapCustomerToDealer({ Id: '9', CompanyName: 'Child', ParentRef: { value: '1' } }).isJob).toBe(true);
  });
});

describe('classifyDealerSyncPlan', () => {
  const existing: ExistingDealer[] = [
    { id: 10, name: 'Acme Motors', address: '123 King', province: 'ON', quickbooksId: '1' },
    { id: 11, name: 'Beta Auto', address: '9 Bay', province: null, quickbooksId: null },
    { id: 12, name: 'Gamma Cars', address: '5 Elm', province: 'BC', quickbooksId: '999' },
  ];

  const customers: QboCustomer[] = [
    { Id: '1', CompanyName: 'Acme Motors', BillAddr: { Line1: '123 King' }, PrimaryEmailAddr: { Address: 'a@acme.test' } },
    { Id: '2', CompanyName: 'Beta Auto', BillAddr: { Line1: '9 Bay' } },
    { Id: '888', CompanyName: 'Gamma Cars', BillAddr: { Line1: '5 Elm' } },
    { Id: '3', CompanyName: 'New Dealer', BillAddr: { Line1: '1 New' } },
    { Id: '4', CompanyName: 'Job Co', Job: true },
    { Id: '5' },
  ];

  const plan = classifyDealerSyncPlan(customers, existing);
  const byQb = new Map(plan.map((r) => [r.qbId, r]));

  it('skips Job sub-customers and nameless records', () => {
    expect(plan).toHaveLength(4);
    expect(byQb.has('4')).toBe(false);
    expect(byQb.has('5')).toBe(false);
  });

  it('marks a quickbooks_id match as already-linked', () => {
    expect(byQb.get('1')).toMatchObject({ action: 'already-linked', dealerId: 10, dealerName: 'Acme Motors' });
  });

  it('marks an unlinked name+address match as link', () => {
    expect(byQb.get('2')).toMatchObject({ action: 'link', dealerId: 11 });
  });

  it('marks a name+address match already linked to a different QB id as skip-collision', () => {
    expect(byQb.get('888')).toMatchObject({ action: 'skip-collision', dealerId: 12 });
  });

  it('marks an unmatched customer as create and carries display fields', () => {
    expect(byQb.get('3')).toMatchObject({ action: 'create', company: 'New Dealer' });
    expect(byQb.get('3')?.dealerId).toBeUndefined();
  });

  it('carries email/phone from the customer onto the plan row', () => {
    expect(byQb.get('1')?.email).toBe('a@acme.test');
  });
});

describe('sync summary param encode/decode', () => {
  it('round-trips a result through the flash param', () => {
    const summary = { created: 12, linked: 7, skipped: 3 };
    expect(decodeSyncSummary(encodeSyncSummary(summary))).toEqual(summary);
  });

  it('encodes as <created>.<linked>.<skipped>', () => {
    expect(encodeSyncSummary({ created: 1, linked: 0, skipped: 5 })).toBe('1.0.5');
  });

  it('rejects malformed params', () => {
    expect(decodeSyncSummary('1.2')).toBeNull(); // too few parts
    expect(decodeSyncSummary('1.2.3.4')).toBeNull(); // too many parts
    expect(decodeSyncSummary('a.b.c')).toBeNull(); // non-numeric
    expect(decodeSyncSummary('-1.0.0')).toBeNull(); // negative
    expect(decodeSyncSummary('')).toBeNull();
  });
});
