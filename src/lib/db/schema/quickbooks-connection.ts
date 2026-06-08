import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bigIdentity, timestamps } from './_columns';
import { authUsers } from './auth';

// The single in-app QuickBooks Online OAuth connection (chunk 0068). The app is
// single-tenant → one QBO company → exactly one connection row, not a per-user
// token table. Tokens are stored **encrypted at rest** (`sealed-box.ts`,
// AES-256-GCM) because they grant full read access to the books; the raw values
// never touch this table. `realm_id` identifies which QBO company was connected
// — it is NOT in the token and arrives only as a callback query param, so it is
// persisted here and scopes every later API call (see
// `docs/chunks/0060-quickbooks-integration/research.md` §realmId gotcha).
//
// Config/connection table (not domain data) → no `actors` mixin; `connected_by_id`
// records who completed the OAuth consent. `updated_at` (via `timestamps`) tracks
// the last token refresh — the access token is rotated ~hourly, the refresh token
// on every refresh. Singleton enforced by the `singleton` boolean: a UNIQUE on a
// column that's always `true` admits at most one row, and the CHECK stops anyone
// flipping it false to sneak in a second. App upserts via
// `onConflictDoUpdate({ target: singleton })`.
export const quickbooksConnection = pgTable(
  'quickbooks_connection',
  {
    id: bigIdentity(),
    singleton: boolean('singleton').notNull().default(true),
    realmId: text('realm_id').notNull(),
    accessTokenEnc: text('access_token_enc').notNull(),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }).notNull(),
    connectedById: uuid('connected_by_id').references(() => authUsers.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('quickbooks_connection_singleton_unique').on(table.singleton),
    check('quickbooks_connection_singleton_true', sql`${table.singleton}`),
    index('quickbooks_connection_connected_by_id_idx').on(table.connectedById),
  ]
);
