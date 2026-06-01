import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/catalyst/button';
import { loadQuotes } from '@/features/quotes/queries';
import { QuotesAdmin } from '@/features/quotes/quotes-admin';

// Quote index. Mirrors `/admin/dealers` and `/admin/people` (server-component
// data loader → client `<DataTable>` consumer). Both admin and coach reach
// it via `quote:edit` — same gate the `/quotes/new` composer and
// `/quotes/[id]` edit-mode page use.
export default async function QuotesPage() {
  await assertCan('quote:edit'); // expected: server-only — admin || coach
  const all = await loadQuotes();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quotes"
        description="Every quote in the pipeline — drafts, sent, accepted, declined."
        actions={
          // Page-level `assertCan('quote:edit')` already gates this surface, so
          // the button needs no extra gate. Opens the composer with no dealer
          // pre-selected — the coach picks the dealer in the composer.
          <Button href="/quotes/new" color="brand">
            New Quote
          </Button>
        }
      />
      <QuotesAdmin quotes={all} />
    </div>
  );
}
