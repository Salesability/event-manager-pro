import { loadCoaches, loadDealers } from '@/features/schedule/queries';

export default async function ListsPage() {
  const [dealers, coaches] = await Promise.all([loadDealers(), loadCoaches()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Manage Lists</h1>
          <p className="mt-1 text-sm text-stone-600">
            Dealers and coaches imported from the legacy spreadsheet.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ListCard title="Dealerships" emoji="🏢" count={dealers.length}>
          {dealers.length === 0 ? (
            <EmptyState icon="🏢" label="No dealers yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {dealers.map((d) => (
                <li
                  key={d.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 transition hover:border-accent hover:bg-navy-pale"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-navy">{d.name}</div>
                    {d.address && (
                      <div className="mt-0.5 truncate text-xs text-stone-600">📍 {d.address}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>

        <ListCard title="Sales Coaches" emoji="🎯" count={coaches.length}>
          {coaches.length === 0 ? (
            <EmptyState icon="🎯" label="No coaches yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {coaches.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 transition hover:border-accent hover:bg-navy-pale"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-navy">
                      {c.firstName} {c.lastName}
                    </div>
                    {c.primaryPhone && (
                      <div className="text-xs text-stone-600">{c.primaryPhone}</div>
                    )}
                    {c.primaryEmail && (
                      <div className="truncate text-xs text-status-blue">{c.primaryEmail}</div>
                    )}
                    {c.specialty && (
                      <div className="mt-0.5 truncate text-xs text-stone-600">⭐ {c.specialty}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ListCard>
      </div>
    </div>
  );
}

function ListCard({
  title,
  emoji,
  count,
  children,
}: {
  title: string;
  emoji: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <header className="flex items-center justify-between border-b border-stone-200 bg-stone-100 px-5 py-3">
        <span className="text-sm font-semibold text-navy">
          {emoji} {title}
        </span>
        <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">
          {count}
        </span>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EmptyState({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-stone-400">
      <span className="text-3xl">{icon}</span>
      <span className="text-sm font-semibold text-stone-600">{label}</span>
    </div>
  );
}
