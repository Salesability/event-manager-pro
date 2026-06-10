// One-shot reset for the CA-sandbox re-link (0074 live-smoke prep). After
// switching the QBO connection from the US sample sandbox to the CA sandbox,
// `dealers.quickbooks_id` / `service_items.quickbooks_id` still hold the US
// company's entity ids — which COLLIDE with the CA company's ids, so the sync
// shows false "already linked" rows pointing at the wrong CA customers/items.
//
// This NULLs those links so a fresh "Sync dealers" + "Pull items" on
// /admin/quickbooks re-derives them honestly against the connected CA company.
//
// SANDBOX ONLY — reversible (the next Sync/Pull re-links). Requires arg "reset".
//   set -a && source .env.local && set +a && node scripts/0074-ca-relink-reset.mjs reset

import postgres from 'postgres';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL (source .env.local).');
  process.exit(1);
}
if (process.argv[2] !== 'reset') {
  console.error('Usage: node scripts/0074-ca-relink-reset.mjs reset');
  process.exit(1);
}
if (/database-url-production|prod/i.test(DATABASE_URL)) {
  console.error('Refusing to run against a production-looking DATABASE_URL.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
try {
  const [before] = await sql`
    select
      (select count(quickbooks_id)::int from dealers) as dealers_linked,
      (select count(quickbooks_id)::int from service_items) as items_linked`;
  console.log('before:', JSON.stringify(before));

  const d = await sql`update dealers set quickbooks_id = null where quickbooks_id is not null returning id`;
  const s = await sql`update service_items set quickbooks_id = null where quickbooks_id is not null returning id`;
  console.log(`cleared: ${d.length} dealer link(s), ${s.length} service_item link(s)`);

  const [after] = await sql`
    select
      (select count(quickbooks_id)::int from dealers) as dealers_linked,
      (select count(quickbooks_id)::int from service_items) as items_linked`;
  console.log('after:', JSON.stringify(after));
} finally {
  await sql.end();
}
