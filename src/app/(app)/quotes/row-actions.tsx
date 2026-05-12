import Link from 'next/link';
import type { Quote } from '@/features/quotes/queries';

// Read-only row actions for `/quotes`. v1 only exposes a `View` affordance
// that routes to the Phase 3 edit-mode page. Eventually grows the staff
// accept/decline buttons (0026 follow-up (c)) — at which point this file
// converts to `'use client'`.
export function QuoteRowActions({ quote }: { quote: Quote }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Link
        href={`/quotes/${quote.id}`}
        aria-label={`View ${quote.dealerName}'s quote`}
        className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
      >
        View
      </Link>
    </div>
  );
}
