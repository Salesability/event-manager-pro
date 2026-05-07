import { loadDealers } from '@/features/schedule/queries';
import { DealersAdmin } from '@/features/dealers/dealers-admin';

// Dealers admin. People (incl. coaches) live on /admin/people.
export default async function DealershipsPage() {
  const dealers = await loadDealers();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl text-navy">Dealers</h1>
      <DealersAdmin dealers={dealers} />
    </div>
  );
}
