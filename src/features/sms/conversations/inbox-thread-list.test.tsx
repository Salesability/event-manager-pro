import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { InboxThreadList, type InboxViewThread } from './inbox-thread-list';

// Node-env render check (no DOM): call the hook-free list component as a
// function and flatten its element tree's text leaves, then assert on the
// concatenated text. Mirrors service-items-list.test.tsx.
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
const flat = (threads: InboxViewThread[]) =>
  texts(InboxThreadList({ threads, selectedId: null, onSelect: () => {} })).join('');

const thread = (
  over: Partial<InboxViewThread> & { id: number; dealerName: string },
): InboxViewThread => ({
  campaignId: 1,
  startDate: '2026-08-01',
  endDate: '2026-08-02',
  phone: '+15065551234',
  lastMessageAtIso: '2026-07-14T15:00:00.000Z',
  unread: false,
  optedOut: false,
  messages: [],
  reassignCandidates: [],
  ...over,
});

describe('InboxThreadList', () => {
  it('renders dealer/event/phone context per row with an unread badge', () => {
    const all = flat([
      thread({
        id: 1,
        dealerName: 'Summerside Hyundai',
        unread: true,
        messages: [
          {
            id: 10,
            direction: 'inbound',
            body: 'What time does the event start?',
            status: null,
            errorCode: null,
            aiDrafted: false,
            createdAtIso: '2026-07-14T15:00:00.000Z',
          },
        ],
      }),
      thread({ id: 2, dealerName: 'Parkway Mazda', optedOut: true }),
    ]);
    expect(all).toContain('Summerside Hyundai');
    expect(all).toContain('new reply'); // unread badge on row 1
    expect(all).toContain('Aug 1, 2026 – Aug 2, 2026');
    expect(all).toContain('+15065551234');
    expect(all).toContain('What time does the event start?'); // last-message preview
    expect(all).toContain('Parkway Mazda');
    expect(all).toContain('opted out'); // STOP badge on row 2
  });

  it('prefixes an outbound last message with You: and skips the preview when empty', () => {
    const withOutbound = flat([
      thread({
        id: 1,
        dealerName: 'Fairley & Stevens Ford',
        messages: [
          {
            id: 11,
            direction: 'outbound',
            body: 'See you Saturday at 9.',
            status: 'delivered',
            errorCode: null,
            aiDrafted: false,
            createdAtIso: '2026-07-14T15:00:00.000Z',
          },
        ],
      }),
    ]);
    expect(withOutbound).toContain('You: ');
    expect(withOutbound).toContain('See you Saturday at 9.');

    const noMessages = flat([thread({ id: 2, dealerName: 'Sydney Mazda' })]);
    expect(noMessages).toContain('Sydney Mazda');
    expect(noMessages).not.toContain('You: ');
  });

  it('marks the selected row with aria-current', () => {
    const el = InboxThreadList({
      threads: [thread({ id: 1, dealerName: 'A' }), thread({ id: 2, dealerName: 'B' })],
      selectedId: 2,
      onSelect: () => {},
    });
    // Walk to the row <button> elements and collect their aria-current.
    const buttons: Array<{ 'aria-current'?: string }> = [];
    (function walk(node: unknown) {
      if (node == null || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const props = (node as ReactElement<Record<string, unknown>>).props as
        | Record<string, unknown>
        | undefined;
      if ((node as ReactElement).type === 'button') {
        buttons.push(props as { 'aria-current'?: string });
      }
      if (props?.children) walk(props.children);
    })(el);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]['aria-current']).toBeUndefined();
    expect(buttons[1]['aria-current']).toBe('true');
  });
});
