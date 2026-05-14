import type { Quote, QuoteStatus } from './queries';

// Derived-status keys for rendering. `'expired'` is presentational only — the
// underlying row stays `status='sent'` per 0044's Option B (derived field, no
// migration). Anything that switches on the *real* lifecycle uses
// `quote.status`; anything that paints a pill/badge uses `displayStatusKey`.
export type DisplayStatusKey = QuoteStatus | 'expired';

export function displayStatusKey(quote: Quote): DisplayStatusKey {
  return quote.isExpired ? 'expired' : quote.status;
}
