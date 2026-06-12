import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { eventsUrl, googleCalendarConfig, googleCalendarConfigured } from './calendar';

const SA = 'eventpro-calendar@eventpro-498313.iam.gserviceaccount.com';
const CAL = 'c_eb45@group.calendar.google.com';
const SUBJECT = 'shannon@salesability.ca';

function clearEnv() {
  delete process.env.GOOGLE_CALENDAR_SA_EMAIL;
  delete process.env.GOOGLE_CALENDAR_ID;
  delete process.env.GOOGLE_CALENDAR_SUBJECT;
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe('googleCalendarConfigured', () => {
  it('is false when no env is set', () => {
    expect(googleCalendarConfigured()).toBe(false);
  });

  it('is false when only some vars are set', () => {
    process.env.GOOGLE_CALENDAR_SA_EMAIL = SA;
    process.env.GOOGLE_CALENDAR_ID = CAL;
    // subject missing
    expect(googleCalendarConfigured()).toBe(false);
  });

  it('is true when all three are set', () => {
    process.env.GOOGLE_CALENDAR_SA_EMAIL = SA;
    process.env.GOOGLE_CALENDAR_ID = CAL;
    process.env.GOOGLE_CALENDAR_SUBJECT = SUBJECT;
    expect(googleCalendarConfigured()).toBe(true);
  });
});

describe('googleCalendarConfig', () => {
  it('throws when not configured', () => {
    expect(() => googleCalendarConfig()).toThrow(/are not set/);
  });

  it('returns the trimmed config when set', () => {
    process.env.GOOGLE_CALENDAR_SA_EMAIL = `  ${SA}  `;
    process.env.GOOGLE_CALENDAR_ID = CAL;
    process.env.GOOGLE_CALENDAR_SUBJECT = SUBJECT;
    expect(googleCalendarConfig()).toEqual({ saEmail: SA, calendarId: CAL, subject: SUBJECT });
  });
});

describe('eventsUrl', () => {
  it('encodes the calendar id and defaults sendUpdates=all', () => {
    expect(eventsUrl(CAL)).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/c_eb45%40group.calendar.google.com/events?sendUpdates=all'
    );
  });

  it('appends and encodes the event id and honours sendUpdates', () => {
    expect(eventsUrl('cal', 'evt 1', 'none')).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/cal/events/evt%201?sendUpdates=none'
    );
  });
});
