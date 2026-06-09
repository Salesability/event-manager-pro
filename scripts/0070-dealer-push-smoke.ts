// Throwaway fixture for the 0070 chunk-end browser smoke: seeds ONE unlinked
// dealer (no quickbooks_id) so /dealerships/[id] can be eyeballed with the
// QuickBooks section rendering its "Not in QuickBooks yet" state + the
// "Push to QuickBooks" button. Sandbox `dealers` is empty after 0069, so there
// is otherwise no dealer detail page to view.
//
// The QuickBooks section only renders when a live QB connection exists
// (getConnection()); the sandbox OAuth connection from the 0069 round-trip
// satisfies that. The smoke is READ-ONLY — it verifies the button renders and
// must NOT click it (a click writes a real Customer to the sandbox QBO company).
//
// Usage:
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0070-dealer-push-smoke.ts insert
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/0070-dealer-push-smoke.ts cleanup
//
// `insert` prints the new dealer id → visit /dealerships/<id>. `cleanup` deletes
// every dealer carrying the fixture marker (idempotent).

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { dealers } from '../src/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing env: DATABASE_URL');
  process.exit(1);
}

const FIXTURE_MARKER = '0070-dealer-push-smoke';

const arg = process.argv[2];
if (arg !== 'insert' && arg !== 'cleanup') {
  console.error('Usage: tsx scripts/0070-dealer-push-smoke.ts <insert|cleanup>');
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(pg, { schema });

async function insert() {
  const [row] = await db
    .insert(dealers)
    .values({
      publicId: randomBytes(9).toString('base64url'),
      name: '0070 Push Smoke Motors',
      address: '100 Test Ave, Toronto ON M5V 1A1',
      province: 'ON',
      status: 'active',
      acquiredVia: FIXTURE_MARKER,
      // quickbooksId intentionally null → "Not in QuickBooks yet" + push button.
    })
    .returning({ id: dealers.id });
  console.log(`Inserted fixture dealer id=${row.id}`);
  console.log(`Visit /dealerships/${row.id} — expect the QuickBooks section + "Push to QuickBooks" button.`);
  console.log('Do NOT click Push (it writes a real Customer to the sandbox QBO company).');
}

async function cleanup() {
  const rows = await db
    .delete(dealers)
    .where(eq(dealers.acquiredVia, FIXTURE_MARKER))
    .returning({ id: dealers.id });
  console.log(`Deleted ${rows.length} fixture dealer(s):`, rows.map((r) => r.id));
}

(async () => {
  try {
    if (arg === 'insert') await insert();
    else await cleanup();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pg.end();
  }
})();
