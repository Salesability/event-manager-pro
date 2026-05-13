import { RowActions } from '@/components/app/row-actions';
import type { Quote } from '@/features/quotes/queries';

// Read-only row actions for `/quotes`. v1 only exposes a `View` affordance
// that routes to the Phase 3 edit-mode page. Eventually grows the staff
// accept/decline buttons (0026 follow-up (c)) — at which point this file
// converts to `'use client'`.
export function QuoteRowActions({ quote }: { quote: Quote }) {
  return (
    <RowActions
      actions={[
        {
          kind: 'view',
          href: `/quotes/${quote.id}`,
          ariaSuffix: `${quote.dealerName}'s quote`,
        },
      ]}
    />
  );
}
