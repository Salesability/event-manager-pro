// Module-level constants shared between `actions.ts` (which is `'use server'`
// and therefore can only export async functions) and its tests / other
// consumers. Anything that needs a named export from outside an action belongs
// here, not in `actions.ts`.

// Cap on rendered client-address line count in the Bill To block. Sized for
// the dealer-row Bill To budget that `MAX_LINE_ITEMS = 13` in
// `src/lib/pdf/render-quote.ts` was measured against.
export const MAX_ADDRESS_LINES = 4;
