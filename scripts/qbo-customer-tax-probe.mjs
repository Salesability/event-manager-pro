// READ-ONLY probe: does the QBO API return a Customer's DefaultTaxCodeRef for
// this (Canadian) company? Fetches customers and reports, per customer, the
// DefaultTaxCodeRef (if returned), Taxable, and the billing province. Confirms
// whether "per-customer default tax code in QB" (Option C) is API-readable.
//
// GET/query only — no writes, no token refresh. Self-contained (no app imports).
//
// Usage (prod):
//   QBO_TOKEN_ENC_KEY="$(gcloud secrets versions access latest --secret=quickbooks-token-enc-key --project=eventpro-498313)" \
//   QBO_ENV=production ./scripts/with-prod-db.sh node scripts/qbo-customer-tax-probe.mjs

import { createDecipheriv } from 'node:crypto';
import postgres from 'postgres';

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
const [conn] = await sql`
  select realm_id, access_token_enc, access_token_expires_at
  from quickbooks_connection limit 1`;
await sql.end();
if (!conn) {
  console.error('No quickbooks_connection row.');
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

// Pull up to 100 customers (one page is plenty for a yes/no readability check).
const json = await qboGet(
  `query?query=${encodeURIComponent('SELECT * FROM Customer STARTPOSITION 1 MAXRESULTS 100')}&minorversion=${MV}`,
);
const customers = json?.QueryResponse?.Customer ?? [];

console.log(`realm=${realm} env=${QBO_ENV}\n`);
console.log(`Fetched ${customers.length} customer(s).\n`);

const withDefault = customers.filter((c) => c.DefaultTaxCodeRef?.value != null);
console.log(`>>> ${withDefault.length} of ${customers.length} have a DefaultTaxCodeRef returned by the API.\n`);

// Show the ones WITH a default code (the signal we care about), plus a few samples.
const show = (c) =>
  `  #${c.Id} "${c.DisplayName ?? c.CompanyName ?? '?'}"` +
  ` | DefaultTaxCodeRef=${c.DefaultTaxCodeRef?.value ?? '—'}` +
  ` | Taxable=${c.Taxable ?? '—'}` +
  ` | province=${c.BillAddr?.CountrySubDivisionCode ?? '—'}`;

if (withDefault.length) {
  console.log('=== customers WITH a default tax code ===');
  for (const c of withDefault) console.log(show(c));
  console.log('');
}
console.log('=== first 8 customers (sample) ===');
for (const c of customers.slice(0, 8)) console.log(show(c));
