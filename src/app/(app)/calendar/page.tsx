import {
  loadAvailabilityBlocks,
  loadCampaigns,
  loadCoaches,
} from '@/features/schedule/queries';
import { CalendarView } from './calendar-view';

export default async function CalendarPage() {
  const today = new Date();
  // Pull a wide range so navigation across months stays fast (one fetch per page load).
  const rangeStart = isoDate(new Date(today.getFullYear() - 1, 0, 1));
  const rangeEnd = isoDate(new Date(today.getFullYear() + 1, 11, 31));

  const [coaches, campaigns, blocks] = await Promise.all([
    loadCoaches(),
    loadCampaigns(),
    loadAvailabilityBlocks(rangeStart, rangeEnd),
  ]);

  return (
    <CalendarView
      coaches={coaches}
      campaigns={campaigns}
      blocks={blocks}
      mode="app"
    />
  );
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
