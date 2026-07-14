'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/catalyst/badge';
import { Button } from '@/components/catalyst/button';
import { Select } from '@/components/catalyst/select';
import { Textarea } from '@/components/catalyst/textarea';
import { Section } from '@/components/app/section';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  draftThreadReply,
  markThreadRead,
  reassignThread,
  replyToThread,
} from '../actions';

// Client half of the conversation console (0106 Phase 3). Mirrors SmsPanel:
// data arrives serialized from the server page, every mutation routes through
// the Server Actions above and re-pulls via router.refresh(). The opted-out
// gate here is display-only — `sendThreadReply` re-checks the registry
// server-side immediately before dispatch.

export type ConversationsPanelProps = {
  conversations: Array<{
    id: number;
    phone: string;
    lastMessageAtIso: string;
    unread: boolean;
    optedOut: boolean;
    messages: Array<{
      id: number;
      direction: 'inbound' | 'outbound';
      body: string;
      status: string | null;
      errorCode: string | null;
      aiDrafted: boolean;
      createdAtIso: string;
    }>;
    reassignCandidates: Array<{
      campaignId: number;
      dealerName: string;
      startDate: string;
    }>;
  }>;
};

export function ConversationsPanel({ conversations }: ConversationsPanelProps) {
  return (
    <Section title="Conversations" variant="card">
      {conversations.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No replies yet. Inbound texts to the campaign sender land here,
          attached to the campaign that most recently texted the number.
        </p>
      ) : (
        <ul className="space-y-4">
          {conversations.map((c) => (
            <ConversationThread key={c.id} conversation={c} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ConversationThread({
  conversation,
}: {
  conversation: ConversationsPanelProps['conversations'][number];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reply, setReply] = useState('');
  // D1 provenance: the current reply text started life as an AI draft
  // (approve/edit both count; clearing the box resets it).
  const [replyIsAiDraft, setReplyIsAiDraft] = useState(false);
  const [reassignTo, setReassignTo] = useState('');

  function onReply() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('threadId', String(conversation.id));
      fd.set('body', reply);
      if (replyIsAiDraft) fd.set('aiDrafted', 'true');
      const result = toLegacyResult<{ ok: true }>(await replyToThread(fd));
      if ('ok' in result) {
        toast.success('Reply sent');
        setReply('');
        setReplyIsAiDraft(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function onDraft() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('threadId', String(conversation.id));
      const result = toLegacyResult<{ ok: true; draft: string }>(
        await draftThreadReply(fd),
      );
      if ('ok' in result) {
        setReply(result.draft);
        setReplyIsAiDraft(true);
      } else {
        toast.error(result.error);
      }
    });
  }

  function onMarkRead() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('threadId', String(conversation.id));
      const result = toLegacyResult<{ ok: true }>(await markThreadRead(fd));
      if ('ok' in result) {
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function onReassign() {
    if (!reassignTo) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('threadId', String(conversation.id));
      fd.set('campaignId', reassignTo);
      const result = toLegacyResult<{ ok: true }>(await reassignThread(fd));
      if ('ok' in result) {
        toast.success('Conversation moved to the other campaign');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <li className="rounded-lg border border-zinc-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-zinc-800">{conversation.phone}</span>
        {conversation.unread && <Badge color="brand">new reply</Badge>}
        {conversation.optedOut && <Badge color="red">opted out (STOP)</Badge>}
        <span className="text-xs text-zinc-500">
          last activity {formatDateTime(conversation.lastMessageAtIso)}
        </span>
        {conversation.unread && (
          <Button plain compact type="button" onClick={onMarkRead} disabled={pending}>
            Mark read
          </Button>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {conversation.messages.map((m) => (
          <li
            key={m.id}
            className={m.direction === 'inbound' ? 'flex justify-start' : 'flex justify-end'}
          >
            <div
              className={
                m.direction === 'inbound'
                  ? 'max-w-[85%] rounded-lg bg-zinc-100 px-3 py-2'
                  : 'max-w-[85%] rounded-lg bg-blue-50 px-3 py-2'
              }
            >
              <p className="whitespace-pre-wrap text-sm text-zinc-800">{m.body}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{formatDateTime(m.createdAtIso)}</span>
                {m.direction === 'outbound' && m.status && (
                  <Badge color={statusColor(m.status)}>{m.status}</Badge>
                )}
                {m.direction === 'outbound' && m.status === 'failed' && m.errorCode && (
                  <span className="text-red-600">{m.errorCode}</span>
                )}
                {m.aiDrafted && <Badge color="zinc">AI draft</Badge>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {conversation.optedOut ? (
        <p className="mt-3 text-sm text-zinc-500">
          This number replied STOP — the conversation is permanently halted; no
          further messages can be sent.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              if (e.target.value.trim() === '') setReplyIsAiDraft(false);
            }}
            rows={2}
            maxLength={1600}
            aria-label={`Reply to ${conversation.phone}`}
            placeholder="Type a reply, or draft one with AI…"
          />
          <div className="flex items-center justify-end gap-2">
            {replyIsAiDraft && (
              <span className="mr-auto text-xs text-zinc-500">
                AI draft — edit freely; nothing sends until you click Send.
              </span>
            )}
            <Button outline compact type="button" onClick={onDraft} disabled={pending}>
              Draft AI reply
            </Button>
            <Button
              color="brand"
              compact
              type="button"
              onClick={onReply}
              disabled={pending || !reply.trim()}
            >
              Send reply
            </Button>
          </div>
        </div>
      )}

      {conversation.reassignCandidates.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3">
          <span className="text-xs text-zinc-500">Wrong campaign?</span>
          <Select
            value={reassignTo}
            onChange={(e) => setReassignTo(e.target.value)}
            aria-label="Move conversation to campaign"
            className="max-w-xs"
          >
            <option value="">Move to…</option>
            {conversation.reassignCandidates.map((cand) => (
              <option key={cand.campaignId} value={String(cand.campaignId)}>
                {cand.dealerName} — {formatDate(cand.startDate)}
              </option>
            ))}
          </Select>
          <Button
            outline
            compact
            type="button"
            onClick={onReassign}
            disabled={pending || !reassignTo}
          >
            Move
          </Button>
        </div>
      )}
    </li>
  );
}

function statusColor(status: string): 'zinc' | 'brand' | 'green' | 'amber' | 'red' {
  switch (status) {
    case 'delivered':
      return 'green';
    case 'sent':
      return 'brand';
    case 'undelivered':
      return 'amber';
    case 'failed':
      return 'red';
    default:
      return 'zinc';
  }
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
