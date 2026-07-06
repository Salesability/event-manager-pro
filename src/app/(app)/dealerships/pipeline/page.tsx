import Link from 'next/link';
import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { loadDealerPipelineDashboard } from '@/features/schedule/queries';
import { PipelineDashboardView } from '@/features/dealers/pipeline-dashboard';

// Management dashboard over the 0087 dealer prospecting pipeline (0088). A
// read-only aggregate of the same data the /dealerships commitment queue works
// operationally — funnel, workload, activity, and blockers, each drilling
// through to the pre-filtered queue. Gated `admin:access` to match the
// /dealerships index (coaches can't browse dealerships today — decision.md D2);
// the static `pipeline` segment resolves ahead of the sibling `[id]` route.
export default async function PipelineDashboardPage() {
  await assertCan('admin:access'); // expected: server-only
  const dashboard = await loadDealerPipelineDashboard();

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dealerships"
        className="text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
      >
        ← Dealers
      </Link>
      <PageHeader
        title="Pipeline dashboard"
        description="Prospecting funnel, workload, activity, and blockers across every dealer prospect."
      />
      <PipelineDashboardView data={dashboard} />
    </div>
  );
}
