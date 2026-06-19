// Shared shape of a create-time duplicate-detected result (chunk 0085). Lives in
// its own types-only module so client form components can import it without
// pulling in `dedup.ts`'s server-side `@/lib/db` imports.
//
// The action returns one of these (instead of throwing/blind-inserting) and the
// form re-submits with a decision flag: `reuseContactId` (link the matched
// contact), `linkQuickbooksId` (born-link the dealer to the matched Customer),
// or `createAnyway` (bypass all checks).
export type DuplicateResult =
  | { kind: 'contact'; via: 'email' | 'phone'; contactId: number; name: string; matchedValue: string }
  | { kind: 'dealer-local'; dealerId: number; name: string; address: string | null }
  | { kind: 'dealer-quickbooks'; quickbooksId: string; name: string };
