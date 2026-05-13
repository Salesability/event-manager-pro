import { RowActions } from '@/components/app/row-actions';
import type { Quote } from '@/features/quotes/queries';

// Row action for `/quotes` rows. Labelled `Edit` (not `View`) because
// `/quotes/[id]` IS the quote composer — an editor, not a reading surface.
// Per the View-xor-Edit rule in `docs/wiki/layout.md`, the label describes
// *what the user is about to do*, not the surface type. Eventually grows the
// staff accept/decline buttons (0026 follow-up (c)) — at which point this
// file converts to `'use client'`.
export function QuoteRowActions({ quote }: { quote: Quote }) {
  return (
    <RowActions
      actions={[
        {
          kind: 'edit',
          href: `/quotes/${quote.id}`,
          ariaSuffix: `${quote.dealerName}'s quote`,
        },
      ]}
    />
  );
}
