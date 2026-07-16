'use client';

import { useTransition } from 'react';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/catalyst/badge';
import { Button } from '@/components/catalyst/button';
import { MsaStatusBadge, QuoteStatusBadge } from '@/components/app/status-badge';
import { useConfirm } from '@/components/app/confirm-dialog';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { cancelCampaign, setMsaWaived } from '@/features/schedule/actions';
import {
  sendClientCampaignConfirmation,
  sendCoachCampaignConfirmation,
} from '@/features/email/actions';
import type { CommercialStatus } from '@/features/schedule/commercial-status';
import { nextCommercialStep } from '@/features/schedule/next-step';
import type { Campaign } from '@/features/schedule/queries';

type EventDetailProps = {
  campaign: Campaign;
  /** 0093: per-event quote + per-client MSA standing (+ exposed flag). Omitted
   *  for cancelled events (no commercial surface). */
  commercial?: CommercialStatus;
  onEdit: () => void;
  onClose: () => void;
};

export function EventDetail({ campaign, commercial, onEdit, onClose }: EventDetailProps) {
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  async function onCancel() {
    if (
      !(await confirm({
        title: `Cancel this campaign at ${campaign.dealerName}?`,
        message: 'It will be hidden from the calendar but kept for history.',
        confirmLabel: 'Cancel campaign',
        cancelLabel: 'Keep campaign',
        destructive: true,
      }))
    )
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

  // 0100: toggle the per-event MSA waiver. Closes the panel on success — the
  // whole commercial surface (banner, MSA row, dot) is recomputed server-side,
  // and `dialog.campaign` here is a snapshot, so re-opening shows fresh state.
  function onToggleMsaWaived() {
    const next = !campaign.msaWaived;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(campaign.id));
      fd.set('waived', String(next));
      const result = toLegacyResult(await setMsaWaived(fd));
      if ('ok' in result) {
        toast.success(next ? 'MSA marked not required for this event' : 'MSA requirement restored');
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  async function onEmailClient() {
    if (!campaign.email) {
      toast.error('No client email on file for this campaign.');
      return;
    }
    if (
      !(await confirm({
        title: 'Email the client?',
        message: `Send confirmation to ${campaign.contact || 'the dealer contact'} <${campaign.email}>?`,
        confirmLabel: 'Send',
      }))
    )
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('campaignId', String(campaign.id));
      const result = toLegacyResult(await sendClientCampaignConfirmation(fd));
      if ('ok' in result) toast.success('Confirmation sent');
      else toast.error(result.error);
    });
  }

  async function onEmailCoach() {
    if (!campaign.coachName) {
      toast.error('No coach assigned to this campaign.');
      return;
    }
    if (
      !(await confirm({
        title: 'Email the coach?',
        message: `Send assignment confirmation to ${campaign.coachName}?`,
        confirmLabel: 'Send',
      }))
    )
      return;
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

  // 0104: the dialog is the workflow hub, so the single next funnel step renders
  // as the one brand primary; every other funnel CTA — and the campaign Edit
  // button — stays `outline`, keeping exactly one primary on screen (matches the
  // "brand blue is the one primary" button rule). No new status logic: the step
  // is derived from the already-computed `commercial` status.
  const nextStep = nextCommercialStep(campaign.status, commercial);
  const primary = { color: 'brand' as const };
  const secondary = { outline: true as const };
  const quoteIsNext =
    nextStep === 'create-quote' ||
    nextStep === 'edit-quote' ||
    nextStep === 'accept-quote';
  const quoteVariant = quoteIsNext ? primary : secondary;
  const sendMsaVariant = nextStep === 'send-msa' ? primary : secondary;
  // 0104 follow-up: Edit is never the funnel primary. When the funnel is complete
  // (protected — accepted quote + active/waived MSA, nothing left to do), surface
  // a "Back to calendar" done-action as the brand primary instead of emphasizing
  // Edit — the coach came here to move the deal forward and there's nothing left
  // to move.
  const funnelComplete = commercial != null && !commercial.exposed;

  return (
    <div className="mt-4 flex flex-col gap-4">
      {confirmDialog}
      {commercial && (
        <div
          className={
            commercial.exposed
              ? 'flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'
              : 'flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900'
          }
        >
          <span aria-hidden>{commercial.exposed ? '⚠' : '✓'}</span>
          <span>{commercialBannerText(commercial)}</span>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Date" value={dateLabel} />
        <Row label="Dealership" value={campaign.dealerName} />
        {campaign.dealerAddress && <Row label="Address" value={campaign.dealerAddress} fullWidth />}
        {campaign.contact && <Row label="Contact" value={campaign.contact} />}
        {campaign.phone && <Row label="Phone" value={campaign.phone} />}
        {campaign.email && (
          <Row label="Email" value={<span className="text-brand-700">{campaign.email}</span>} />
        )}
        {campaign.styleLabel && (
          <Row
            label="Format"
            value={
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
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
          value={<Badge color={statusBadgeColor(campaign.status)}>{campaign.status}</Badge>}
        />
        {(campaign.status === 'booked' || campaign.status === 'completed') && (
          <Row
            label="Calendar"
            value={
              <Badge color={gcalBadge(campaign.gcalSyncStatus).color}>
                {gcalBadge(campaign.gcalSyncStatus).label}
              </Badge>
            }
          />
        )}
        {commercial && (
          <Row
            label="Quote"
            value={
              commercial.quoteStatus ? (
                <QuoteStatusBadge status={commercial.quoteStatus} />
              ) : (
                <span className="text-zinc-500">No quote yet</span>
              )
            }
          />
        )}
        {commercial && (
          <Row
            label="MSA"
            value={
              commercial.msaWaived ? (
                // 0100: waived — calm neutral pill, not an unfinished step.
                <Badge color="zinc">Not required</Badge>
              ) : commercial.msaStatus ? (
                <MsaStatusBadge status={commercial.msaStatus} />
              ) : (
                <span className="text-zinc-500">No active MSA</span>
              )
            }
          />
        )}
      </dl>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 pt-4">
        <Can capability="email:send">
          <Button
            outline
            compact
            type="button"
            onClick={onEmailClient}
            disabled={pending || !campaign.email}
            title={campaign.email ? 'Send the dealer contact a booking confirmation' : 'No client email on file'}
          >
            Email Client
          </Button>
          <Button
            outline
            compact
            type="button"
            onClick={onEmailCoach}
            disabled={pending || !campaign.coachId}
            title={campaign.coachId ? 'Send the assigned coach a booking confirmation' : 'No coach assigned'}
          >
            Email Coach
          </Button>
        </Can>
        {campaign.status === 'booked' && (campaign.smsEmail ?? 0) > 0 && (
          // 0103 D1: the SMS add-on gate — the button only exists when the
          // accepted quote carries Digital (SMS/Email) touches. Sits with the
          // other per-campaign messaging actions; the full surface (import /
          // review / launch / log) needs server data, so it lives on its own
          // page, same move as Send MSA → dealer page.
          <Can capability="sms:send">
            <Button
              outline
              compact
              href={`/calendar/${campaign.id}/sms`}
              title="Compose and send campaign texts to the dealer's list"
            >
              SMS
            </Button>
            {/* 0108: appointment booking rides the same SMS add-on — the slot
                grid + per-recipient booking links live on their own page. */}
            <Button
              outline
              compact
              href={`/calendar/${campaign.id}/bookings`}
              title="Set up the appointment slot grid and see who booked"
            >
              Bookings
            </Button>
          </Can>
        )}
        <span className="flex-1" />
        {campaign.status !== 'cancelled' && (
          <Can capability="quote:edit">
            {commercial?.quoteId ? (
              // A quote already exists for this event — link to it instead of
              // offering to start a second one. A draft is still editable
              // ("Edit Quote"); once sent/accepted it reads "View Quote". 0104:
              // emphasized (brand) when the quote is the next step — including
              // "accept-quote", where viewing it is where the accept happens.
              <Button
                {...quoteVariant}
                compact
                href={`/quotes/${commercial.quoteId}`}
                title={
                  nextStep === 'accept-quote'
                    ? 'Open the quote to accept it — that locks in the booking'
                    : undefined
                }
              >
                {commercial.quoteStatus === 'draft' ? 'Edit Quote' : 'View Quote'}
              </Button>
            ) : (
              <Button
                {...quoteVariant}
                compact
                href={`/quotes/new?campaignId=${campaign.id}&dealerId=${campaign.dealerId}`}
              >
                Create Quote
              </Button>
            )}
          </Can>
        )}
        {campaign.status !== 'cancelled' &&
          commercial &&
          commercial.msaStatus !== 'active' &&
          !commercial.msaWaived && (
          // The MSA is per-client and sent from the dealer page (admin-only).
          // Surfaced here only when the client has no active MSA AND the event
          // isn't waived (0100) — the other half of "protect the commitment".
          <Can capability="admin:access">
            {/* 0104: carry the event context to the (per-dealer) MSA page so the
                admin returns to this event's dialog after sending. Emphasized
                (brand) when sending the MSA is the next funnel step. */}
            <Button
              {...sendMsaVariant}
              compact
              href={`/dealerships/${campaign.dealerId}?returnEvent=${campaign.id}`}
            >
              Send MSA
            </Button>
          </Can>
        )}
        {campaign.status !== 'cancelled' &&
          (commercial?.msaStatus !== 'active' || campaign.msaWaived) && (
          // 0100: per-event MSA opt-out toggle. Reversible; admin-gated like the
          // other campaign-edit controls (booking is back-office). Hidden when an
          // MSA is already active AND the event isn't waived — waiving is a no-op
          // there (the active MSA already satisfies exposure + the accept gate),
          // so offering "MSA not required" would just be noise (mirrors the
          // "Send MSA" button, which is likewise hidden on an active MSA). Still
          // shown as "Require MSA" on an already-waived event so it can be undone.
          <Can capability="campaign:edit">
            <Button
              outline
              compact
              type="button"
              onClick={onToggleMsaWaived}
              disabled={pending}
              title={
                campaign.msaWaived
                  ? 'Restore the MSA requirement for this event'
                  : 'Mark this event as not needing an MSA — its quote can then be accepted without one'
              }
            >
              {campaign.msaWaived ? 'Require MSA' : 'MSA not required'}
            </Button>
          </Can>
        )}
        {campaign.status !== 'cancelled' && (
          <Can capability="campaign:cancel">
            <Button
              destructive
              compact
              type="button"
              onClick={onCancel}
              disabled={pending}
            >
              Cancel Campaign
            </Button>
          </Can>
        )}
        <Can capability="campaign:edit">
          {/* 0104: Edit is never the funnel primary — the next step, or the
              "Back to calendar" done-action below, carries the brand emphasis. */}
          <Button outline compact type="button" onClick={onEdit}>
            Edit
          </Button>
        </Can>
        {funnelComplete && (
          // 0104 follow-up: the deal is fully protected — nothing left to do
          // here, so the brand primary is a clean exit back to the calendar
          // rather than an emphasized Edit. Closing also strips `?event=`.
          <Button color="brand" compact type="button" onClick={onClose}>
            Back to calendar
          </Button>
        )}
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
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-900">{value}</dd>
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

// 0100: the commercial banner copy is waiver-aware. A waived event never blames
// the MSA — when exposed it's only the missing quote; when protected it says the
// MSA isn't required for this event (there's no active MSA to credit).
function commercialBannerText(commercial: CommercialStatus): string {
  // The cancellation fee (MSA §2.iii) needs BOTH an accepted quote AND an active
  // (or waived) MSA. When exposed, name exactly which dimension is still open so
  // the required action is unambiguous — don't say "quote and/or MSA" when only
  // one is actually missing (mirrors the `isExposed` predicate).
  const quoteOk = commercial.quoteStatus === 'accepted';
  const msaOk = commercial.msaStatus === 'active' || commercial.msaWaived;

  if (commercial.exposed) {
    const gap = !quoteOk && !msaOk
      ? 'no accepted quote and no active MSA yet'
      : !quoteOk
        ? 'no accepted quote yet'
        : 'no active MSA yet'; // quote accepted, MSA missing
    const waivedNote = commercial.msaWaived ? ' (MSA not required for this event.)' : '';
    return `Commercially exposed — ${gap}, so the cancellation fee (MSA §2.iii) is not yet in force. Lock it in below.${waivedNote}`;
  }
  return commercial.msaWaived
    ? 'Protected — accepted quote. MSA not required for this event.'
    : 'Protected — accepted quote + active MSA.';
}

function gcalBadge(status: Campaign['gcalSyncStatus']): {
  color: 'green' | 'zinc' | 'red';
  label: string;
} {
  switch (status) {
    case 'synced':
      return { color: 'green', label: 'Synced' };
    case 'failed':
      return { color: 'red', label: 'Sync failed' };
    case 'pending':
    default:
      return { color: 'zinc', label: 'Not synced' };
  }
}

function statusBadgeColor(status: Campaign['status']): 'green' | 'zinc' | 'red' | 'brand' {
  switch (status) {
    case 'booked':
      return 'green';
    case 'completed':
      return 'zinc';
    case 'cancelled':
      return 'red';
    case 'draft':
    default:
      return 'brand';
  }
}
