'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { Can } from '@/components/auth/can';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { cancelCampaign } from '@/features/schedule/actions';
import {
  sendClientCampaignConfirmation,
  sendCoachCampaignConfirmation,
} from '@/features/email/actions';
import type { Campaign } from '@/features/schedule/queries';

type EventDetailProps = {
  campaign: Campaign;
  onEdit: () => void;
  onClose: () => void;
};

export function EventDetail({ campaign, onEdit, onClose }: EventDetailProps) {
  const [pending, startTransition] = useTransition();

  function onCancel() {
    if (!confirm(`Cancel this campaign at ${campaign.dealerName}? It will be hidden from the calendar but kept for history.`))
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(campaign.id));
      const result = toLegacyResult(await cancelCampaign(fd));
      if ('ok' in result) {
        toast.success('Campaign cancelled');
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  function onEmailClient() {
    if (!campaign.email) {
      toast.error('No client email on file for this campaign.');
      return;
    }
    if (!confirm(`Send confirmation to ${campaign.contact || 'the dealer contact'} <${campaign.email}>?`))
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('campaignId', String(campaign.id));
      const result = toLegacyResult(await sendClientCampaignConfirmation(fd));
      if ('ok' in result) toast.success('Confirmation sent');
      else toast.error(result.error);
    });
  }

  function onEmailCoach() {
    if (!campaign.coachName) {
      toast.error('No coach assigned to this campaign.');
      return;
    }
    if (!confirm(`Send assignment confirmation to ${campaign.coachName}?`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('campaignId', String(campaign.id));
      const result = toLegacyResult(await sendCoachCampaignConfirmation(fd));
      if ('ok' in result) toast.success('Confirmation sent');
      else toast.error(result.error);
    });
  }

  const dateLabel =
    campaign.startDate === campaign.endDate
      ? formatDate(campaign.startDate)
      : `${formatDate(campaign.startDate)} – ${formatDate(campaign.endDate)}`;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Date" value={dateLabel} />
        <Row label="Dealership" value={campaign.dealerName} />
        {campaign.dealerAddress && <Row label="Address" value={campaign.dealerAddress} fullWidth />}
        {campaign.contact && <Row label="Contact" value={campaign.contact} />}
        {campaign.phone && <Row label="Phone" value={campaign.phone} />}
        {campaign.email && (
          <Row label="Email" value={<span className="text-status-blue">{campaign.email}</span>} />
        )}
        {campaign.styleLabel && (
          <Row
            label="Format"
            value={
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {campaign.styleLabel}
              </span>
            }
          />
        )}
        {campaign.audienceSourceLabel && (
          <Row label="Data Source" value={campaign.audienceSourceLabel} />
        )}
        {campaign.qtyRecords != null && <Row label="Qty Records" value={String(campaign.qtyRecords)} />}
        {campaign.smsEmail != null && <Row label="SMS/Email" value={String(campaign.smsEmail)} />}
        {campaign.letters != null && <Row label="Letters" value={String(campaign.letters)} />}
        {campaign.bdc != null && <Row label="BDC" value={String(campaign.bdc)} />}
        {campaign.coachName && <Row label="Coach" value={campaign.coachName} />}
        {campaign.notes && <Row label="Notes" value={campaign.notes} fullWidth />}
        <Row
          label="Status"
          value={
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(campaign.status)}`}
            >
              {campaign.status}
            </span>
          }
        />
      </dl>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Can capability="email:send">
          <button
            type="button"
            onClick={onEmailClient}
            disabled={pending || !campaign.email}
            title={campaign.email ? 'Send the dealer contact a booking confirmation' : 'No client email on file'}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-primary transition hover:border-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Email Client
          </button>
          <button
            type="button"
            onClick={onEmailCoach}
            disabled={pending || !campaign.coachId}
            title={campaign.coachId ? 'Send the assigned coach a booking confirmation' : 'No coach assigned'}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-primary transition hover:border-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Email Coach
          </button>
        </Can>
        <span className="flex-1" />
        {campaign.status !== 'cancelled' && (
          <Can capability="quote:edit">
            <Link
              href={`/quotes/new?campaignId=${campaign.id}&dealerId=${campaign.dealerId}`}
              className="rounded-lg border border-accent/40 bg-white px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10"
            >
              Create Quote
            </Link>
          </Can>
        )}
        {campaign.status !== 'cancelled' && (
          <Can capability="campaign:cancel">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-lg border border-status-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-status-red transition hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel Campaign
            </button>
          </Can>
        )}
        <Can capability="campaign:edit">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-primary/90"
          >
            Edit
          </button>
        </Can>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'col-span-2 flex flex-col gap-0.5' : 'flex flex-col gap-0.5'}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function statusBadgeClass(status: Campaign['status']) {
  switch (status) {
    case 'booked':
      return 'bg-status-green/15 text-status-green';
    case 'completed':
      return 'bg-muted text-muted-foreground';
    case 'cancelled':
      return 'bg-status-red/15 text-status-red';
    case 'draft':
    default:
      return 'bg-status-blue/15 text-status-blue';
  }
}
