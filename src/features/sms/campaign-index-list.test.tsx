import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { CampaignIndexList, type CampaignIndexRow } from './campaign-index-list';

// Node-env render check (no DOM): call the hook-free list component as a
// function and flatten its element tree's text leaves, then assert on the
// concatenated text. Mirrors inbox-thread-list.test.tsx.
function texts(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const c of node) texts(c, out);
    return out;
  }
  if (typeof node === 'object' && 'props' in (node as object)) {
    texts((node as ReactElement<{ children?: unknown }>).props?.children, out);
  }
  return out;
}
const flat = (rows: CampaignIndexRow[]) => texts(CampaignIndexList({ rows })).join('');

function hrefs(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const c of node) hrefs(c, out);
    return out;
  }
  const el = node as ReactElement<{ href?: string; children?: unknown }>;
  if ('props' in el) {
    if (typeof el.props?.href === 'string') out.push(el.props.href);
    hrefs(el.props?.children, out);
  }
  return out;
}

const row = (
  over: Partial<CampaignIndexRow> & { campaignId: number; dealerName: string },
): CampaignIndexRow => ({
  startDate: '2026-08-01',
  endDate: '2026-08-02',
  status: 'booked',
  gateActive: true,
  recipientCount: 0,
  sendCount: 0,
  lastSendAtIso: null,
  threadCount: 0,
  unreadThreads: 0,
  hotThreads: 0,
  warmThreads: 0,
  coldThreads: 0,
  ...over,
});

describe('CampaignIndexList', () => {
  it('renders dealer/date/state per row and links to the event SMS page', () => {
    const rows = [
      row({
        campaignId: 7,
        dealerName: 'Summerside Hyundai',
        recipientCount: 120,
        sendCount: 2,
        lastSendAtIso: '2026-07-14T15:00:00.000Z',
        threadCount: 3,
        unreadThreads: 2,
      }),
      row({
        campaignId: 9,
        dealerName: 'Parkway Mazda',
        status: 'completed',
        gateActive: false,
        sendCount: 1,
        lastSendAtIso: '2026-06-01T15:00:00.000Z',
      }),
    ];
    const all = flat(rows);
    expect(all).toContain('Summerside Hyundai');
    expect(all).toContain('SMS active');
    expect(all).toContain('120 recipients');
    expect(all).toContain('2 new replies');
    expect(all).toContain('3 conversations');
    // History-only row: zinc badge, no unread noise.
    expect(all).toContain('Parkway Mazda');
    expect(all).toContain('history');

    expect(hrefs(CampaignIndexList({ rows }))).toEqual([
      '/calendar/7/sms',
      '/calendar/9/sms',
    ]);
  });

  it('marks cancelled campaigns and pluralizes counts sensibly', () => {
    const all = flat([
      row({
        campaignId: 3,
        dealerName: 'Ghost Motors',
        status: 'cancelled',
        gateActive: false,
        recipientCount: 1,
        sendCount: 1,
        lastSendAtIso: '2026-05-01T12:00:00.000Z',
        threadCount: 1,
        unreadThreads: 1,
      }),
    ]);
    expect(all).toContain('cancelled');
    expect(all).toContain('1 recipient ·');
    expect(all).toContain('1 send,');
    expect(all).toContain('1 conversation');
    expect(all).toContain('1 new reply');
  });

  it('renders the explanatory empty state when nothing qualifies', () => {
    expect(flat([])).toContain('No SMS campaigns yet');
  });

  it('shows temperature aggregates only when non-zero (0110)', () => {
    const withTemps = flat([
      row({
        campaignId: 4,
        dealerName: 'Steele Ford',
        threadCount: 5,
        hotThreads: 2,
        warmThreads: 1,
      }),
    ]);
    expect(withTemps).toContain('2 hot');
    expect(withTemps).toContain('1 warm');
    expect(withTemps).not.toContain('cold');

    expect(flat([row({ campaignId: 5, dealerName: 'Quiet Motors' })])).not.toContain(
      'hot',
    );
  });
});
