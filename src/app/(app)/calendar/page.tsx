import {
  loadAvailabilityBlocks,
  loadCampaignStyles,
  loadCampaigns,
  loadCoaches,
  loadDealers,
  loadAudienceSources,
} from '@/features/schedule/queries';
import {
  loadCommercialStatusByCampaign,
  type CommercialStatus,
} from '@/features/schedule/commercial-status';
import { CalendarView } from './calendar-view';

export default async function CalendarPage() {
  const today = new Date();
  // Pull a wide range so navigation across months stays fast (one fetch per page load).
  const rangeStart = isoDate(new Date(today.getFullYear() - 1, 0, 1));
  const rangeEnd = isoDate(new Date(today.getFullYear() + 1, 11, 31));

  const [coaches, campaigns, blocks, dealers, styles, sources] =
    await Promise.all([
      loadCoaches(),
      loadCampaigns(),
      loadAvailabilityBlocks(rangeStart, rangeEnd),
      loadDealers(),
      loadCampaignStyles(),
      loadAudienceSources(),
    ]);

  // Hide cancelled campaigns from the calendar by default.
  const visibleCampaigns = campaigns.filter((c) => c.status !== 'cancelled');

  // 0093: per-event quote + per-client MSA standing (+ exposed flag), keyed by
  // campaign id (string keys so the plain object crosses the server→client
  // boundary — a Map wouldn't serialize). Drives the event-detail badges + the
  // ribbon "exposed" marker.
  const statusMap = await loadCommercialStatusByCampaign(visibleCampaigns);
  const commercialStatus: Record<string, CommercialStatus> = {};
  for (const [id, s] of statusMap) commercialStatus[String(id)] = s;

  return (
    <CalendarView
      coaches={coaches}
      campaigns={visibleCampaigns}
      commercialStatus={commercialStatus}
      blocks={blocks}
      dealers={dealers}
      styles={styles}
      sources={sources}
      mode="app"
    />
  );
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
