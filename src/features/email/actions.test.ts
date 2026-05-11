import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  sendEmail: vi.fn(),
  loadCampaign: vi.fn(),
  loadCampaigns: vi.fn(),
  loadCoach: vi.fn(),
  coachShareLink: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const err = new Error(`NEXT_REDIRECT;replace;${path};307;`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${path};307;`;
    throw err;
  },
}));
vi.mock('@/lib/auth/assert-can', () => ({ assertCan: mocks.assertCan }));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real = await importOriginal<
    typeof import('@/lib/auth/load-team-membership')
  >();
  return {
    ...real,
    loadCurrentMembership: mocks.loadCurrentMembership,
  };
});
vi.mock('@/lib/email/send', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/email/templates', () => ({
  clientConfirmation: () => ({ subject: 'Client', text: 'Body' }),
  coachConfirmation: () => ({ subject: 'Coach', text: 'Body' }),
  coachShareLink: mocks.coachShareLink,
}));
vi.mock('@/features/schedule/queries', () => ({
  loadCampaign: mocks.loadCampaign,
  loadCampaigns: mocks.loadCampaigns,
  loadCoach: mocks.loadCoach,
}));

import {
  sendClientCampaignConfirmation,
  sendCoachCampaignConfirmation,
  sendCoachShareLinkEmail,
} from './actions';

// 0033: actions return the safe-action wrapper shape `{data?, serverError?,
// validationErrors?}`. Unwrap to the legacy `{ok|error}` shape for the
// existing assertions; throws on serverError so unexpected denials surface
// loudly.
async function call<T>(
  p: Promise<{ data?: T; serverError?: string; validationErrors?: unknown } | undefined | null>,
): Promise<T> {
  const r = await p;
  if (!r) throw new Error('action returned null/undefined');
  if (r.serverError) throw new Error(`unexpected serverError: ${r.serverError}`);
  if (r.validationErrors) {
    throw new Error(`unexpected validationErrors: ${JSON.stringify(r.validationErrors)}`);
  }
  if (r.data === undefined) {
    throw new Error('action returned undefined data');
  }
  return r.data;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SITE_URL;
  mocks.assertCan.mockResolvedValue({
    id: 'admin-uuid',
    email: 'sender@example.test',
    app_metadata: { role: 'admin' },
  });
  mocks.getUser.mockResolvedValue({
    id: 'admin-uuid',
    email: 'sender@example.test',
    app_metadata: { role: 'admin' },
  });
  mocks.loadCurrentMembership.mockResolvedValue(null);
  mocks.sendEmail.mockResolvedValue({ ok: true, id: 'msg_1' });
  mocks.coachShareLink.mockReturnValue({ subject: 'Share', text: 'Body' });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

function fdWith(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const bookedCampaign = {
  id: 1,
  status: 'booked' as const,
  email: 'client@example.test',
  contact: 'Jane',
  phone: '555',
  dealerName: 'Acme',
  dealerAddress: '1 Main',
  startDate: '2026-06-01',
  endDate: '2026-06-03',
  styleLabel: 'VIP',
  audienceSourceLabel: 'PBS',
  coachId: null,
  qtyRecords: 100,
  smsEmail: 50,
  letters: 50,
  bdc: null,
  notes: null,
};

describe('sendClientCampaignConfirmation: status gate', () => {
  it('rejects cancelled campaigns', async () => {
    mocks.loadCampaign.mockResolvedValueOnce({ ...bookedCampaign, status: 'cancelled' });
    const result = await call(sendClientCampaignConfirmation(fdWith({ campaignId: '1' })));
    expect(result).toMatchObject({
      error: expect.stringContaining('cancelled'),
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects draft campaigns', async () => {
    mocks.loadCampaign.mockResolvedValueOnce({ ...bookedCampaign, status: 'draft' });
    const result = await call(sendClientCampaignConfirmation(fdWith({ campaignId: '1' })));
    expect(result).toMatchObject({ error: expect.stringContaining('draft') });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects completed campaigns', async () => {
    mocks.loadCampaign.mockResolvedValueOnce({ ...bookedCampaign, status: 'completed' });
    const result = await call(sendClientCampaignConfirmation(fdWith({ campaignId: '1' })));
    expect(result).toMatchObject({ error: expect.stringContaining('completed') });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('proceeds for booked campaigns', async () => {
    mocks.loadCampaign.mockResolvedValueOnce(bookedCampaign);
    const result = await call(sendClientCampaignConfirmation(fdWith({ campaignId: '1' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });
});

describe('sendCoachCampaignConfirmation: status gate', () => {
  it('rejects non-booked campaigns', async () => {
    mocks.loadCampaign.mockResolvedValueOnce({
      ...bookedCampaign,
      status: 'cancelled',
      coachId: 7,
    });
    const result = await call(sendCoachCampaignConfirmation(fdWith({ campaignId: '1' })));
    expect(result).toMatchObject({ error: expect.stringContaining('cancelled') });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('proceeds for booked campaigns with a coach assigned', async () => {
    mocks.loadCampaign.mockResolvedValueOnce({ ...bookedCampaign, coachId: 7 });
    mocks.loadCoach.mockResolvedValueOnce({
      id: 7,
      firstName: 'Scott',
      lastName: 'Grady',
      primaryEmail: 'scott@example.test',
      primaryPhone: null,
    });
    const result = await call(sendCoachCampaignConfirmation(fdWith({ campaignId: '1' })));
    expect(result).toEqual({ ok: true });
  });
});

describe('sendCoachShareLinkEmail: SITE_URL allowlist', () => {
  it('refuses when SITE_URL is unset (no Host-header fallback)', async () => {
    mocks.loadCoach.mockResolvedValueOnce({
      id: 7,
      firstName: 'Scott',
      lastName: 'Grady',
      primaryEmail: 'scott@example.test',
    });
    mocks.loadCampaigns.mockResolvedValueOnce([]);
    const result = await call(sendCoachShareLinkEmail(fdWith({ coachId: '7' })));
    expect(result).toMatchObject({
      error: expect.stringContaining('SITE_URL is not configured'),
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('builds shareUrl from SITE_URL verbatim when configured', async () => {
    process.env.SITE_URL = 'https://app.example.test';
    mocks.loadCoach.mockResolvedValueOnce({
      id: 7,
      firstName: 'Scott',
      lastName: 'Grady',
      primaryEmail: 'scott@example.test',
    });
    mocks.loadCampaigns.mockResolvedValueOnce([]);
    const result = await call(sendCoachShareLinkEmail(fdWith({ coachId: '7' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.coachShareLink).toHaveBeenCalledWith(
      expect.objectContaining({
        shareUrl: 'https://app.example.test/share/coach/7',
      }),
    );
  });

  it('strips a trailing slash from SITE_URL before composing shareUrl', async () => {
    process.env.SITE_URL = 'https://app.example.test/';
    mocks.loadCoach.mockResolvedValueOnce({
      id: 7,
      firstName: 'Scott',
      lastName: 'Grady',
      primaryEmail: 'scott@example.test',
    });
    mocks.loadCampaigns.mockResolvedValueOnce([]);
    await call(sendCoachShareLinkEmail(fdWith({ coachId: '7' })));
    expect(mocks.coachShareLink).toHaveBeenCalledWith(
      expect.objectContaining({
        shareUrl: 'https://app.example.test/share/coach/7',
      }),
    );
  });
});
