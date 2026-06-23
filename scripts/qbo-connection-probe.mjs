// READ-ONLY: prod QuickBooks connection state — realm + token expiries. The app
// auto-refreshes the access token as long as the REFRESH token is still valid, so
// that's the gate for whether Phase 3 can push without a reconnect.
import postgres from 'postgres';
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }
const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const [c] = await sql`
  select realm_id, access_token_expires_at, refresh_token_expires_at, updated_at
  from quickbooks_connection order by id limit 1`;
await sql.end();
if (!c) { console.log('\n⚠ NO quickbooks_connection row on prod — QBO is NOT connected. Reconnect at /admin/quickbooks.'); process.exit(0); }
const now = new Date();
const fmt = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
const hrs = (d) => ((new Date(d) - now) / 3.6e6);
console.log(`\nprod QBO connection:`);
console.log(`  realm_id                 : ${c.realm_id}`);
console.log(`  last updated (refresh)   : ${fmt(c.updated_at)}`);
console.log(`  access  token expires at : ${fmt(c.access_token_expires_at)}  (${hrs(c.access_token_expires_at).toFixed(1)}h from now)`);
console.log(`  refresh token expires at : ${fmt(c.refresh_token_expires_at)}  (${(hrs(c.refresh_token_expires_at) / 24).toFixed(1)}d from now)`);
const refreshOk = new Date(c.refresh_token_expires_at) > now;
console.log(`\n→ refresh token ${refreshOk ? 'VALID — Phase 3 can push (app will auto-refresh the access token).' : 'EXPIRED — a reconnect at /admin/quickbooks is required before Phase 3.'}`);
