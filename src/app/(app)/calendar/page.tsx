import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import {
  loadAvailabilityBlocks,
  loadCampaignStyles,
  loadCampaigns,
  loadCoaches,
  loadDealers,
  loadAudienceSources,
} from '@/features/schedule/queries';
import { CalendarView } from './calendar-view';

export default async function CalendarPage() {
  const today = new Date();
  // Pull a wide range so navigation across months stays fast (one fetch per page load).
  const rangeStart = isoDate(new Date(today.getFullYear() - 1, 0, 1));
  const rangeEnd = isoDate(new Date(today.getFullYear() + 1, 11, 31));

  const [coaches, campaigns, blocks, dealers, styles, sources, membership] =
    await Promise.all([
      loadCoaches(),
      loadCampaigns(),
      loadAvailabilityBlocks(rangeStart, rangeEnd),
      loadDealers(),
      loadCampaignStyles(),
      loadAudienceSources(),
      loadCurrentMembership(),
    ]);

  // Hide cancelled campaigns from the calendar by default.
  const visibleCampaigns = campaigns.filter((c) => c.status !== 'cancelled');

  return (
    <CalendarView
      coaches={coaches}
      campaigns={visibleCampaigns}
      blocks={blocks}
      dealers={dealers}
      styles={styles}
      sources={sources}
      mode="app"
      viewerCoachId={membership?.coachContactId ?? null}
    />
  );
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
