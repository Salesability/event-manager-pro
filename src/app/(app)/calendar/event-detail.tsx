'use client';

import { useTransition } from 'react';
import { toast } from '@/components/ui/toaster';
import { cancelCampaign } from '@/features/schedule/actions';
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
      const result = await cancelCampaign(fd);
      if ('ok' in result) {
        toast.success('Campaign cancelled');
        onClose();
      } else {
        toast.error(result.error);
      }
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
              <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">
                {campaign.styleLabel}
              </span>
            }
          />
        )}
        {campaign.salesLeadSourceLabel && (
          <Row label="Data Source" value={campaign.salesLeadSourceLabel} />
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

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 pt-4">
        <button
          type="button"
          disabled
          title="Coming soon (chunk 5.5)"
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-400"
        >
          Email Client
        </button>
        <button
          type="button"
          disabled
          title="Coming soon (chunk 5.5)"
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-400"
        >
          Email Coach
        </button>
        <span className="flex-1" />
        {campaign.status !== 'cancelled' && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-status-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-status-red transition hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel Campaign
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg bg-navy px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-navy-light"
        >
          Edit
        </button>
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
      <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="text-sm text-stone-800">{value}</dd>
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
      return 'bg-stone-200 text-stone-600';
    case 'cancelled':
      return 'bg-status-red/15 text-status-red';
    case 'draft':
    default:
      return 'bg-status-blue/15 text-status-blue';
  }
}
