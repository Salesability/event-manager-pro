import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { Button } from '@/components/catalyst/button';
import { PageHeader } from '@/components/app/page-header';
import { BookingsPanel } from '@/features/bookings/bookings-panel';
import { loadCampaignBookingOverview } from '@/features/bookings/queries';
import { loadCampaign } from '@/features/schedule/queries';

// Staff booking surface (0108 Phase 4): enable/edit the campaign's slot grid,
// watch availability fill, read the appointment list, and copy per-recipient
// booking links for manual handout (the {{booking_link}} send token is chunk 2).
// Reached from the event dialog's "Bookings" button; gate matches the SMS
// family — the booking link rides the SMS campaign.

export default async function CampaignBookingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await assertCan('sms:send');

  const { id: idParam } = await params;
  const campaignId = Number(idParam);
  if (!Number.isInteger(campaignId) || campaignId <= 0) notFound();

  const campaign = await loadCampaign(campaignId);
  if (!campaign) notFound();

  const overview = await loadCampaignBookingOverview(campaign.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Appointment booking — ${campaign.dealerName}`}
        description={eventDateLabel(campaign.startDate, campaign.endDate)}
        actions={
          <Button outline compact href={`/calendar?event=${campaign.id}`}>
            Back to event
          </Button>
        }
      />
      <BookingsPanel
        campaignId={campaign.id}
        settings={overview.settings}
        tokensMinted={overview.tokensMinted}
        totalRecipients={overview.totalRecipients}
        slots={overview.slots}
        appointments={overview.appointments.map((a) => ({
          id: a.id,
          slotDate: a.slotDate,
          slotStartMinute: a.slotStartMinute,
          firstName: a.firstName,
          lastName: a.lastName,
          phone: a.phone,
          status: a.status,
          createdAtIso: a.createdAt.toISOString(),
        }))}
        recipientLinks={overview.recipientLinks}
      />
    </div>
  );
}

function eventDateLabel(startIso: string, endIso: string): string {
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
