'use client';

import { Badge } from '@/components/catalyst/badge';
import type { ConversationThreadData } from './conversations-panel';

// Master list of the global inbox (0107). Lives apart from inbox-view.tsx so
// the node-env render test can import it without dragging in the Server
// Actions module (server-only) the stateful view wires up. Hook-free on
// purpose — the test calls it as a plain function (mirrors
// service-items-list.test.tsx).

export type InboxViewThread = ConversationThreadData & {
  campaignId: number;
  dealerName: string;
  startDate: string;
  endDate: string;
};

export function InboxThreadList({
  threads,
  selectedId,
  onSelect,
}: {
  threads: InboxViewThread[];
  selectedId: number | null;
  onSelect: (thread: InboxViewThread) => void;
}) {
  return (
    <ul className="divide-y divide-zinc-200">
      {threads.map((t) => {
        const active = t.id === selectedId;
        const last = t.messages[t.messages.length - 1];
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t)}
              aria-current={active ? 'true' : undefined}
              className={
                'block w-full px-4 py-3 text-left transition hover:bg-zinc-50 ' +
                (active ? 'bg-brand-50' : '')
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    'text-sm text-zinc-900 ' + (t.unread ? 'font-semibold' : 'font-medium')
                  }
                >
                  {t.dealerName}
                </span>
                {t.unread && <Badge color="brand">new reply</Badge>}
                {t.optedOut && <Badge color="red">opted out</Badge>}
                <span className="ml-auto text-xs text-zinc-500">
                  {formatDateTime(t.lastMessageAtIso)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {eventDateLabel(t.startDate, t.endDate)} · {t.phone}
              </p>
              {last && (
                <p className="mt-1 truncate text-xs text-zinc-600">
                  {last.direction === 'outbound' ? 'You: ' : ''}
                  {last.body}
                </p>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function eventDateLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  return startIso === endIso ? fmt(startIso) : `${fmt(startIso)} – ${fmt(endIso)}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
