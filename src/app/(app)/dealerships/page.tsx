import Link from 'next/link';
import { assertCan } from '@/lib/auth/assert-can';
import { getUser } from '@/lib/supabase/session';
import { PageHeader } from '@/components/app/page-header';
import { loadDealersIncludingArchived } from '@/features/schedule/queries';
import { DealersAdmin } from '@/features/dealers/dealers-admin';

// Dealers admin. People (incl. coaches) live on /admin/people. Loads archived
// dealers too so the Active / Prospect / Archived filter pills can surface
// them client-side.
export default async function DealershipsPage() {
  await assertCan('admin:access'); // expected: server-only
  const [dealers, user] = await Promise.all([loadDealersIncludingArchived(), getUser()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dealers"
        description="Every dealer account — active, prospect, and archived."
        actions={
          <Link
            href="/dealerships/pipeline"
            className="rounded-lg border border-brand-200 bg-white px-3 py-1 text-xs font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-50"
          >
            Pipeline dashboard →
          </Link>
        }
      />
      <DealersAdmin dealers={dealers} currentUserId={user?.id ?? null} />
    </div>
  );
}
