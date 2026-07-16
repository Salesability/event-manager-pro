'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/catalyst/badge';
import { Button } from '@/components/catalyst/button';
import { Textarea } from '@/components/catalyst/textarea';
import { Section } from '@/components/app/section';
import { useConfirm } from '@/components/app/confirm-dialog';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  importSmsRecipients,
  launchSmsSend,
  type ImportRecipientsResult,
  type LaunchSmsResult,
} from './actions';

// Client half of the campaign SMS surface (0103 Phase 5). All data arrives
// serialized from the server page; every mutation routes through the Phase 3
// Server Actions and re-pulls via router.refresh(), so the pre-send summary
// on screen is always the same evaluation the launch will enforce (they share
// `evaluateCampaignRecipients`).

export type SmsPanelProps = {
  campaignId: number;
  summary: {
    total: number;
    eligible: number;
    excludedOptOut: number;
    excludedStaleConsent: number;
  };
  excluded: Array<{
    phone: string;
    name: string | null;
    reason: 'opted_out' | 'stale_consent';
  }>;
  /** 0105: dealer-scoped prior-send history for imported numbers (only phones
   *  WITH history appear). `identity` is the person-continuity verdict. */
  history: Array<{
    phone: string;
    priorCount: number;
    lastStatus: string;
    lastAtIso: string;
    identity: 'matches' | 'differs' | 'unknown';
  }>;
  defaultBody: string;
  sendLog: Array<{
    id: number;
    body: string;
    createdAtIso: string;
    totalRecipients: number;
    excludedOptOut: number;
    excludedStaleConsent: number;
    messageCounts: Record<string, number>;
  }>;
};

export function SmsPanel({
  campaignId,
  summary,
  excluded,
  history,
  defaultBody,
  sendLog,
}: SmsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState(defaultBody);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  async function onImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose a CSV file first.');
      return;
    }
    if (
      summary.total > 0 &&
      !(await confirm({
        title: 'Replace the recipient list?',
        message: `Importing replaces the ${summary.total} recipient(s) currently on this campaign.`,
        confirmLabel: 'Replace list',
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('campaignId', String(campaignId));
      fd.set('file', file);
      const result = toLegacyResult<Extract<ImportRecipientsResult, { ok: true }>>(
        await importSmsRecipients(fd),
      );
      if ('ok' in result) {
        const dupNote = result.duplicatesDropped
          ? ` (${result.duplicatesDropped} duplicate number(s) dropped)`
          : '';
        toast.success(`Imported ${result.imported} recipient(s)${dupNote}`);
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  async function onLaunch() {
    if (
      !(await confirm({
        title: `Send this text to ${summary.eligible} recipient(s)?`,
        message: `${summary.excludedOptOut} opted-out and ${summary.excludedStaleConsent} stale-consent recipient(s) will be excluded.`,
        confirmLabel: 'Launch send',
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('campaignId', String(campaignId));
      fd.set('body', body);
      const result = toLegacyResult<Extract<LaunchSmsResult, { ok: true }>>(
        await launchSmsSend(fd),
      );
      if ('ok' in result) {
        const failNote = result.failed ? `, ${result.failed} failed at Twilio` : '';
        toast.success(`SMS launched — ${result.accepted} message(s) queued${failNote}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {confirmDialog}
      <Section title="Recipients" variant="card">
        {summary.total > 0 ? (
          <p className="text-sm text-zinc-800">
            <Badge color="green">{summary.total} imported</Badge>{' '}
            <span className="font-medium">
              This campaign&apos;s list is loaded
            </span>{' '}
            — the pre-send review below reflects it. Importing another CSV{' '}
            <span className="font-medium">replaces the whole list</span>.
          </p>
        ) : (
          <p className="text-sm text-zinc-800">
            <span className="font-medium">No list yet</span> — import the
            dealer&apos;s contact CSV to get started.
          </p>
        )}
        <p className="text-sm text-zinc-600">
          CSV columns:{' '}
          <code className="text-xs">
            phone, first_name, last_name, consent_basis, last_contact_at
          </code>
          ; consent_basis is <code className="text-xs">express</code>,{' '}
          <code className="text-xs">implied_purchase</code> or{' '}
          <code className="text-xs">implied_inquiry</code>. Lists are retained for 24
          months, then purged.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700"
          />
          <Button outline compact type="button" onClick={onImport} disabled={pending}>
            Import CSV
          </Button>
        </div>
      </Section>

      <Section title="Pre-send review" variant="card">
        <div className="flex flex-wrap gap-2">
          <Badge color="zinc">{summary.total} imported</Badge>
          <Badge color="green">{summary.eligible} eligible</Badge>
          <Badge color={summary.excludedOptOut ? 'red' : 'zinc'}>
            {summary.excludedOptOut} opted out
          </Badge>
          <Badge color={summary.excludedStaleConsent ? 'amber' : 'zinc'}>
            {summary.excludedStaleConsent} stale consent
          </Badge>
        </div>
        {excluded.length > 0 && (
          <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto text-sm text-zinc-600">
            {excluded.map((r) => (
              <li key={r.phone} className="flex flex-wrap items-baseline gap-x-2">
                {r.name && (
                  <span className="text-xs font-medium text-zinc-700">{r.name}</span>
                )}
                <span className="font-mono text-xs">{r.phone}</span>
                <span className="text-xs text-zinc-500">
                  {r.reason === 'opted_out'
                    ? 'replied STOP — permanently unsubscribed, will never be texted again (applies to every campaign)'
                    : 'implied consent has expired under CASL (24 months after a purchase, 6 after an inquiry) — will be skipped until the dealer records fresh consent or a newer contact date'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {summary.total === 0 && (
          <p className="text-sm text-zinc-500">No recipients imported yet.</p>
        )}
        {history.length > 0 && (
          <div className="mt-3 border-t border-zinc-200 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Prior sends for this dealer
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm text-zinc-600">
              {history.map((h) => (
                <li key={h.phone} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{h.phone}</span>
                  <span className="text-xs text-zinc-500">
                    texted {h.priorCount}× · last {h.lastStatus} {formatDate(h.lastAtIso)}
                  </span>
                  {h.identity === 'matches' && (
                    <Badge color="green">same person as before</Badge>
                  )}
                  {h.identity === 'differs' && (
                    // A changed name on the same number — possibly recycled;
                    // inherited history/consent should be treated with suspicion.
                    <Badge color="amber">name differs from prior sends</Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Compose" variant="card">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={1600}
          aria-label="Message body"
        />
        <p className="text-xs text-zinc-500">
          Variables: {'{{first_name}}'}, {'{{last_name}}'}, {'{{dealer_name}}'}. &ldquo;Reply
          STOP to opt out.&rdquo; is appended automatically if the message doesn&apos;t
          mention STOP.
        </p>
        <div className="flex justify-end">
          <Button
            color="brand"
            compact
            type="button"
            onClick={onLaunch}
            disabled={pending || summary.eligible === 0 || !body.trim()}
            title={
              summary.eligible === 0
                ? 'No eligible recipients — import a list first'
                : `Send to ${summary.eligible} eligible recipient(s)`
            }
          >
            Launch send
          </Button>
        </div>
      </Section>

      <Section title="Send log" variant="card">
        {sendLog.length === 0 ? (
          <p className="text-sm text-zinc-500">No sends yet.</p>
        ) : (
          <ul className="space-y-3">
            {sendLog.map((send) => (
              <li key={send.id} className="rounded-lg border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>{formatDateTime(send.createdAtIso)}</span>
                  <span>·</span>
                  <span>
                    {send.totalRecipients} on list, {send.excludedOptOut} opted out,{' '}
                    {send.excludedStaleConsent} stale
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">{send.body}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['queued', 'sent', 'delivered', 'undelivered', 'failed'] as const).map(
                    (status) =>
                      send.messageCounts[status] ? (
                        <Badge key={status} color={statusColor(status)}>
                          {send.messageCounts[status]} {status}
                        </Badge>
                      ) : null,
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function statusColor(
  status: 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed',
): 'zinc' | 'brand' | 'green' | 'amber' | 'red' {
  switch (status) {
    case 'delivered':
      return 'green';
    case 'sent':
      return 'brand';
    case 'undelivered':
      return 'amber';
    case 'failed':
      return 'red';
    case 'queued':
    default:
      return 'zinc';
  }
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
