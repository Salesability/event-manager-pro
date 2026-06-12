import { describe, expect, it } from 'vitest';
import {
  type GcalCampaign,
  type GcalCampaignCoach,
  type GcalCampaignDealer,
  addDaysIso,
  mapCampaignToGcalEvent,
} from './calendar-event';

const campaign = (over: Partial<GcalCampaign> = {}): GcalCampaign => ({
  id: 42,
  publicId: 'camp_abc',
  startDate: '2026-07-01',
  endDate: '2026-07-03',
  styleLabel: 'In-Store Event',
  contact: 'John Doe',
  phone: '555-1234',
  email: 'john@dealer.test',
  ...over,
});
const dealer = (over: Partial<GcalCampaignDealer> = {}): GcalCampaignDealer => ({
  name: 'Acme Motors',
  address: '123 Main St, Toronto, ON',
  ...over,
});
const coach = (over: Partial<GcalCampaignCoach> = {}): GcalCampaignCoach => ({
  name: 'Jane Smith',
  email: 'jane@salesability.ca',
  colorId: '5',
  ...over,
});

const APP_LINK = 'https://app.example.test/calendar';

describe('addDaysIso', () => {
  it('adds a day within a month', () => {
    expect(addDaysIso('2026-07-03', 1)).toBe('2026-07-04');
  });
  it('rolls over a month boundary', () => {
    expect(addDaysIso('2026-07-31', 1)).toBe('2026-08-01');
  });
  it('rolls over a year boundary', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('handles the leap-year Feb boundary', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('mapCampaignToGcalEvent', () => {
  it('builds an all-day event with an EXCLUSIVE end date (endDate + 1)', () => {
    const e = mapCampaignToGcalEvent(campaign(), dealer(), coach(), APP_LINK);
    expect(e.start).toEqual({ date: '2026-07-01' });
    expect(e.end).toEqual({ date: '2026-07-04' }); // inclusive 07-03 → exclusive 07-04
  });

  it('titles with the dealer name + SaleDay brand and sets the location', () => {
    const e = mapCampaignToGcalEvent(campaign(), dealer(), coach(), APP_LINK);
    expect(e.summary).toBe('🚗 Acme Motors — SaleDay Event');
    expect(e.location).toBe('123 Main St, Toronto, ON');
  });

  it('writes a customer-safe description — no internal ops fields', () => {
    const e = mapCampaignToGcalEvent(campaign(), dealer(), coach(), APP_LINK);
    expect(e.description).toBe(
      ['Coach: Jane Smith', 'Format: In-Store Event', 'Dealer contact: John Doe · 555-1234', '', 'View in SaleDay: https://app.example.test/calendar'].join('\n'),
    );
    // The ops fields the legacy invite leaked must never appear.
    for (const leak of ['Records', 'SMS', 'Letters', 'BDC', 'Source', 'qty']) {
      expect(e.description).not.toMatch(new RegExp(leak, 'i'));
    }
  });

  it('lists the coach (pre-accepted) and the dealer contact as guests', () => {
    const e = mapCampaignToGcalEvent(campaign(), dealer(), coach(), APP_LINK);
    expect(e.attendees).toEqual([
      { email: 'jane@salesability.ca', displayName: 'Jane Smith', responseStatus: 'accepted' },
      { email: 'john@dealer.test', displayName: 'John Doe' },
    ]);
    expect(e.guestsCanInviteOthers).toBe(false);
    expect(e.guestsCanSeeOtherGuests).toBe(false);
  });

  it('omits a guest when its email is missing, keeping attendees an array', () => {
    const e = mapCampaignToGcalEvent(
      campaign({ email: null }),
      dealer(),
      coach({ email: null }),
      APP_LINK,
    );
    expect(e.attendees).toEqual([]);
  });

  it('maps the coach colour and the back-link + source', () => {
    const e = mapCampaignToGcalEvent(campaign(), dealer(), coach(), APP_LINK);
    expect(e.colorId).toBe('5');
    expect(e.extendedProperties).toEqual({ private: { campaignId: '42' } });
    expect(e.source).toEqual({ title: 'SaleDay', url: APP_LINK });
  });

  it('sets the reminder overrides (email 1 day, popup 2 hours)', () => {
    const e = mapCampaignToGcalEvent(campaign(), dealer(), coach(), APP_LINK);
    expect(e.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 },
        { method: 'popup', minutes: 120 },
      ],
    });
  });

  it('drops empty optional fields (no colour, no address, sparse contact)', () => {
    const e = mapCampaignToGcalEvent(
      campaign({ contact: null, phone: null, styleLabel: null }),
      dealer({ address: null }),
      coach({ name: null, colorId: null }),
      APP_LINK,
    );
    expect(e.colorId).toBeUndefined();
    expect(e.location).toBeUndefined();
    // No detail lines → description is just the app link, no leading blank line.
    expect(e.description).toBe('View in SaleDay: https://app.example.test/calendar');
  });
});
