'use client';

import Link from 'next/link';
import { Badge } from '@/components/catalyst/badge';
import { eventDateLabel } from './conversations/inbox-thread-list';

// Campaign index for the /sms tab (0109). Hook-free presentational list —
// the node-env render test calls it as a plain function (mirrors
// inbox-thread-list.tsx). Rows link to the existing per-event ledger page;
// this surface adds navigation, not new SMS behavior.

export type CampaignIndexRow = {
  campaignId: number;
  dealerName: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'booked' | 'cancelled' | 'completed';
  /** Composer usable right now (booked + add-on touches on the quote). */
  gateActive: boolean;
  recipientCount: number;
  sendCount: number;
  lastSendAtIso: string | null;
  threadCount: number;
  unreadThreads: number;
  /** 0110: AI prospect-temperature aggregates (display-only). */
  hotThreads: number;
  warmThreads: number;
  coldThreads: number;
};

export function CampaignIndexList({ rows }: { rows: CampaignIndexRow[] }) {
  if (!rows.length) {
    return (
      <p className="max-w-xl text-sm text-zinc-600">
        No SMS campaigns yet. A booked event whose accepted quote carries Digital
        (SMS / Email) touches appears here automatically — as does any past event
        with send history or replies.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
      {rows.map((r) => (
        <li key={r.campaignId}>
          <Link
            href={`/calendar/${r.campaignId}/sms`}
            className="block px-4 py-3 transition hover:bg-zinc-50"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-900">{r.dealerName}</span>
              {r.gateActive ? (
                <Badge color="brand">SMS active</Badge>
              ) : (
                <Badge color="zinc">history</Badge>
              )}
              {r.status === 'cancelled' && <Badge color="red">cancelled</Badge>}
              {r.unreadThreads > 0 && (
                <Badge color="brand">
                  {r.unreadThreads} new {r.unreadThreads === 1 ? 'reply' : 'replies'}
                </Badge>
              )}
              {r.hotThreads > 0 && <Badge color="red">{r.hotThreads} hot</Badge>}
              {r.warmThreads > 0 && <Badge color="amber">{r.warmThreads} warm</Badge>}
              {r.coldThreads > 0 && <Badge color="sky">{r.coldThreads} cold</Badge>}
              <span className="ml-auto text-xs text-zinc-500">
                {eventDateLabel(r.startDate, r.endDate)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              {r.recipientCount} recipient{r.recipientCount === 1 ? '' : 's'} ·{' '}
              {r.sendCount === 0
                ? 'no sends yet'
                : `${r.sendCount} send${r.sendCount === 1 ? '' : 's'}, last ${formatDateTime(r.lastSendAtIso!)}`}
              {r.threadCount > 0
                ? ` · ${r.threadCount} conversation${r.threadCount === 1 ? '' : 's'}`
                : ''}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
