import { describe, expect, it, vi } from 'vitest';
import { type DealerToPush, mapDealerToCustomer, planDealerPush } from './dealer-push';

// `dealer-push` imports `@/lib/db` (default executor) + `./client` (which pulls
// in `server-only`). Stub both so the module loads without a Postgres pool or
// the server-only guard tripping. The functions tested here are pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

const base: DealerToPush = {
  id: 1,
  name: 'Acme Motors',
  address: null,
  province: null,
  quickbooksId: null,
};

describe('mapDealerToCustomer', () => {
  it('maps the dealer name to both DisplayName and CompanyName', () => {
    const out = mapDealerToCustomer(base);
    expect(out.DisplayName).toBe('Acme Motors');
    expect(out.CompanyName).toBe('Acme Motors');
  });

  it('sends the flat address as BillAddr.Line1 and province as CountrySubDivisionCode', () => {
    const out = mapDealerToCustomer({
      ...base,
      address: '123 King St, Toronto ON M5V 1A1',
      province: 'ON',
    });
    expect(out.BillAddr).toEqual({
      Line1: '123 King St, Toronto ON M5V 1A1',
      CountrySubDivisionCode: 'ON',
    });
  });

  it('omits BillAddr entirely when both address and province are null', () => {
    expect(mapDealerToCustomer(base).BillAddr).toBeUndefined();
  });

  it('emits a province-only BillAddr when address is null but province is set', () => {
    expect(mapDealerToCustomer({ ...base, province: 'BC' }).BillAddr).toEqual({
      CountrySubDivisionCode: 'BC',
    });
  });

  it('maps the contact person name to GivenName/FamilyName when present, omits both when absent', () => {
    const withName = mapDealerToCustomer({
      ...base,
      contactFirstName: 'Dana',
      contactLastName: 'Reyes',
    });
    expect(withName.GivenName).toBe('Dana');
    expect(withName.FamilyName).toBe('Reyes');

    const without = mapDealerToCustomer(base);
    expect(without.GivenName).toBeUndefined();
    expect(without.FamilyName).toBeUndefined();
  });

  it('maps primary contact email + phone when present, omits both when absent', () => {
    const withContact = mapDealerToCustomer({
      ...base,
      primaryEmail: 'sales@acme.test',
      primaryPhone: '555-1234',
    });
    expect(withContact.PrimaryEmailAddr).toEqual({ Address: 'sales@acme.test' });
    expect(withContact.PrimaryPhone).toEqual({ FreeFormNumber: '555-1234' });

    const without = mapDealerToCustomer(base);
    expect(without.PrimaryEmailAddr).toBeUndefined();
    expect(without.PrimaryPhone).toBeUndefined();
  });

  it('prefers the rooftop dealer.phone over the contact phone for PrimaryPhone (0086)', () => {
    const out = mapDealerToCustomer({
      ...base,
      phone: '902-555-0100',
      primaryPhone: '555-1234',
    });
    expect(out.PrimaryPhone).toEqual({ FreeFormNumber: '902-555-0100' });
  });

  it('falls back to the contact phone when dealer.phone is null/absent (no behavior change)', () => {
    expect(
      mapDealerToCustomer({ ...base, phone: null, primaryPhone: '555-1234' }).PrimaryPhone,
    ).toEqual({ FreeFormNumber: '555-1234' });
    // absent `phone` key behaves identically to null
    expect(
      mapDealerToCustomer({ ...base, primaryPhone: '555-1234' }).PrimaryPhone,
    ).toEqual({ FreeFormNumber: '555-1234' });
  });

  it('emits PrimaryPhone from dealer.phone even with no contact phone', () => {
    expect(mapDealerToCustomer({ ...base, phone: '902-555-0100' }).PrimaryPhone).toEqual({
      FreeFormNumber: '902-555-0100',
    });
  });

  it('omits PrimaryPhone when both dealer.phone and contact phone are absent', () => {
    expect(mapDealerToCustomer(base).PrimaryPhone).toBeUndefined();
  });
});

describe('planDealerPush', () => {
  it('returns update for a linked dealer and create for an unlinked one', () => {
    expect(planDealerPush({ quickbooksId: '42' })).toBe('update');
    expect(planDealerPush({ quickbooksId: null })).toBe('create');
  });
});
