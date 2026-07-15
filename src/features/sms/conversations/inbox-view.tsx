'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/catalyst/button';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { markThreadRead } from '../actions';
import { ConversationThread } from './conversations-panel';
import {
  eventDateLabel,
  InboxThreadList,
  type InboxViewThread,
} from './inbox-thread-list';

// Global inbox (0107): master–detail over every campaign's threads. The list
// pane is needs-action-first (server-sorted); opening a thread renders the
// shared ConversationThread internals in place — reply / AI draft / reassign
// behave exactly as on the per-event page. Opening an unread thread clears
// its unread state (the intent's read-on-open), which also drops the nav
// badge count on the next poll.

export function SmsInboxView({ threads }: { threads: InboxViewThread[] }) {
  const router = useRouter();
  // No default selection — auto-opening the top thread would silently mark
  // the newest unread conversation read before anyone actually read it.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const selected = threads.find((t) => t.id === selectedId) ?? null;

  function onSelect(thread: InboxViewThread) {
    setSelectedId(thread.id);
    if (!thread.unread) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('threadId', String(thread.id));
      fd.set('seenThrough', thread.lastMessageAtIso);
      const result = toLegacyResult<{ ok: true }>(await markThreadRead(fd));
      // Read-on-open is best-effort — a failure just leaves the row unread;
      // the explicit "Mark read" button in the detail pane remains.
      if ('ok' in result) router.refresh();
    });
  }

  if (threads.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <p className="text-sm text-zinc-500">
          No conversations yet. Inbound texts to the campaign sender land here,
          across every campaign.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,2fr)_3fr] lg:items-start">
      <div className="rounded-lg border border-zinc-200 bg-white">
        <InboxThreadList threads={threads} selectedId={selectedId} onSelect={onSelect} />
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        {selected ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-3">
              <div>
                <p className="text-sm font-medium text-zinc-900">{selected.dealerName}</p>
                <p className="text-xs text-zinc-500">
                  {eventDateLabel(selected.startDate, selected.endDate)}
                </p>
              </div>
              <Button outline compact href={`/calendar/${selected.campaignId}/sms`}>
                Event SMS page
              </Button>
            </div>
            <ul>
              <ConversationThread conversation={selected} />
            </ul>
          </>
        ) : (
          <p className="text-sm text-zinc-500">
            Select a conversation to read and reply.
          </p>
        )}
      </div>
    </div>
  );
}
