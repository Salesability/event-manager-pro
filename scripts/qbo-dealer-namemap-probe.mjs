// READ-ONLY probe (chunk 0084 verify): for the most-recently-created LINKED
// dealers in the app, fetch their QBO Customer by `quickbooks_id` and report
// whether the contact person's GivenName/FamilyName mapped across (0084), next
// to what the app holds. GET/query only — no writes, no token refresh.
//
// Usage (sandbox / dev): node scripts/qbo-dealer-namemap-probe.mjs
//   (loads .env.local itself for DATABASE_URL / QBO_TOKEN_ENC_KEY / QBO_ENV)

import { createDecipheriv } from 'node:crypto';
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // fall back to ambient env
}

const { DATABASE_URL, QBO_TOKEN_ENC_KEY, QBO_ENV } = process.env;
if (!DATABASE_URL || !QBO_TOKEN_ENC_KEY) {
  console.error('Missing DATABASE_URL or QBO_TOKEN_ENC_KEY.');
  process.exit(1);
}

function decrypt(payload) {
  const key = Buffer.from(QBO_TOKEN_ENC_KEY.trim(), 'base64');
  const buf = Buffer.from(payload.slice(payload.indexOf('.') + 1), 'base64');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

const apiBase =
  QBO_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
const MV = '75';

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

// The most-recently-created linked dealers + their app-side primary contact.
const dealersRows = await sql`
  select d.id, d.name, d.status, d.quickbooks_id, d.created_at,
         c.first_name, c.last_name
  from dealers d
  left join dealer_contacts dc
    on dc.dealer_id = d.id and dc.archived_at is null
  left join contacts c
    on c.id = dc.contact_id
  where d.quickbooks_id is not null and d.archived_at is null
  order by d.created_at desc
  limit 5`;

const [conn] = await sql`
  select realm_id, access_token_enc, access_token_expires_at
  from quickbooks_connection limit 1`;
await sql.end();

if (!conn) {
  console.error('No quickbooks_connection row — sandbox QBO not connected.');
  process.exit(1);
}
if (new Date(conn.access_token_expires_at) <= new Date()) {
  console.error('QBO access token expired — reconnect on /admin/quickbooks, then re-run.');
  process.exit(1);
}

const realm = conn.realm_id;
const token = decrypt(conn.access_token_enc);

async function qboGet(path) {
  const res = await fetch(`${apiBase}/v3/company/${realm}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`QBO GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

console.log(`realm=${realm} env=${QBO_ENV ?? 'sandbox'}`);
console.log(`Most-recent linked dealers: ${dealersRows.length}\n`);

for (const d of dealersRows) {
  const appName = [d.first_name, d.last_name].filter(Boolean).join(' ') || '—';
  let qb;
  try {
    const json = await qboGet(`customer/${d.quickbooks_id}?minorversion=${MV}`);
    qb = json?.Customer;
  } catch (e) {
    console.log(`dealer #${d.id} "${d.name}" (${d.status}) → QB ${d.quickbooks_id}: FETCH FAILED — ${e.message}`);
    continue;
  }
  const qbName = [qb?.GivenName, qb?.FamilyName].filter(Boolean).join(' ') || '—';
  const match = appName === qbName ? 'MATCH' : 'differ';
  console.log(`dealer #${d.id} "${d.name}" (${d.status})  → QB Customer #${qb?.Id} "${qb?.DisplayName}"`);
  console.log(`    contact name : app="${appName}"  qb="${qbName}"  [${match}]`);
  console.log(`    email/phone  : qb email=${qb?.PrimaryEmailAddr?.Address ?? '—'}  phone=${qb?.PrimaryPhone?.FreeFormNumber ?? '—'}`);
  console.log(`    created      : app=${d.created_at?.toISOString?.() ?? d.created_at}\n`);
}
