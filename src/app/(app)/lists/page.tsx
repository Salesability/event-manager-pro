import { loadDealers } from '@/features/schedule/queries';
import { AddDealerButton, DealerRowActions } from './list-actions';

// Dealerships-only after 0020 Phase 4 retired Sales Coaches; people live on /admin/people.
export default async function ListsPage() {
  const dealers = await loadDealers();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-navy">Dealers</h1>
        <AddDealerButton />
      </div>

      {dealers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-stone-400">
          <span className="text-3xl">🏢</span>
          <span className="text-sm font-semibold text-stone-600">No dealers yet</span>
          <span className="text-xs text-stone-500">Use + Add Client to get started.</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {dealers.map((d) => {
            const contactName = [d.contactFirstName, d.contactLastName].filter(Boolean).join(' ');
            const contactLine = [contactName, d.primaryPhone].filter(Boolean).join(' · ');
            return (
              <li
                key={d.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 transition hover:border-accent hover:bg-navy-pale"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-navy">{d.name}</div>
                  {contactLine && (
                    <div className="mt-0.5 truncate text-xs text-stone-600">{contactLine}</div>
                  )}
                  {d.primaryEmail && (
                    <div className="truncate text-xs text-status-blue">{d.primaryEmail}</div>
                  )}
                  {d.address && (
                    <div className="mt-0.5 truncate text-xs text-stone-600">📍 {d.address}</div>
                  )}
                </div>
                <DealerRowActions dealer={d} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
