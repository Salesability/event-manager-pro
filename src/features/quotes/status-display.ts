import type { Quote, QuoteStatus } from './queries';

// Derived-status keys for rendering. `'expired'` is presentational only — the
// underlying row stays `status='sent'` per 0044's Option B (derived field, no
// migration). Anything that switches on the *real* lifecycle uses
// `quote.status`; anything that paints a pill/badge uses `displayStatusKey`.
export type DisplayStatusKey = QuoteStatus | 'expired';

export function displayStatusKey(quote: Quote): DisplayStatusKey {
  return quote.isExpired ? 'expired' : quote.status;
}

export const STATUS_PILL_CLS: Record<DisplayStatusKey, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-status-blue/15 text-status-blue',
  accepted: 'bg-status-green/15 text-status-green',
  declined: 'bg-status-red/15 text-status-red',
  expired: 'bg-amber-100 text-amber-700',
};
