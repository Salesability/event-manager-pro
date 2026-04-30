import { notFound } from 'next/navigation';
import { CalendarView } from '@/app/(app)/calendar/calendar-view';
import {
  loadAvailabilityBlocks,
  loadCampaigns,
  loadCoaches,
} from '@/features/schedule/queries';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function CoachSharePage({ params }: Props) {
  const { id } = await params;
  const coachId = Number(id);
  if (!Number.isFinite(coachId) || coachId <= 0) notFound();

  const today = new Date();
  const rangeStart = isoDate(new Date(today.getFullYear() - 1, 0, 1));
  const rangeEnd = isoDate(new Date(today.getFullYear() + 1, 11, 31));

  const [coaches, campaigns, blocks] = await Promise.all([
    loadCoaches(),
    loadCampaigns(),
    loadAvailabilityBlocks(rangeStart, rangeEnd),
  ]);

  const coach = coaches.find((c) => c.id === coachId);
  if (!coach) notFound();

  const coachCampaigns = campaigns.filter((c) => c.coachId === coachId);
  const coachBlocks = blocks.filter(
    (b) => b.kind !== 'coach_unavailable' || b.coachId === coachId
  );

  return (
    <div className="min-h-screen bg-cream">
      <header className="bg-navy px-8 py-4">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 text-white">
          <span className="font-display text-xl tracking-tight">Event Manager</span>
          <span className="rounded bg-stone-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/90">
            Pro
          </span>
          <span className="ml-3 text-sm text-white/70">
            Personal schedule for {coach.firstName} {coach.lastName}
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] px-8 py-8">
        <CalendarView
          coaches={[coach]}
          campaigns={coachCampaigns}
          blocks={coachBlocks}
          mode="share"
          forcedCoachId={coachId}
        />
      </main>
    </div>
  );
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
