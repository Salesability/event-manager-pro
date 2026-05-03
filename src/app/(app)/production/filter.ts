import type { Campaign } from '@/features/schedule/queries';

export type ProductionFilter = {
  q: string;
  status: string;
  showCancelled: boolean;
};

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function filterCampaigns(rows: Campaign[], { q, status, showCancelled }: ProductionFilter) {
  const today = todayIso();
  let out = rows;
  if (!showCancelled) out = out.filter((c) => c.status !== 'cancelled');
  if (status === 'upcoming') out = out.filter((c) => c.endDate >= today);
  if (status === 'past') out = out.filter((c) => c.endDate < today);
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((c) => {
      return (
        c.dealerName.toLowerCase().includes(needle) ||
        (c.coachName?.toLowerCase().includes(needle) ?? false) ||
        (c.styleLabel?.toLowerCase().includes(needle) ?? false) ||
        (c.notes?.toLowerCase().includes(needle) ?? false) ||
        (c.contact?.toLowerCase().includes(needle) ?? false)
      );
    });
  }
  return out;
}
