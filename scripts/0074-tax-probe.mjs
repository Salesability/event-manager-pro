// READ-ONLY probe for 0074 Phase 1 research: inspect the connected (CA sandbox)
// QBO company's tax setup — TaxCode, TaxRate, and the Preferences.TaxPrefs (AST
// indicator). Self-contained: decrypts the local access token inline (no app
// server-only imports) and only does GET/query (no writes, no token refresh).
//
// Usage: set -a && source .env.local && set +a && node scripts/0074-tax-probe.mjs

import { createDecipheriv } from 'node:crypto';
import postgres from 'postgres';

const { DATABASE_URL, QBO_TOKEN_ENC_KEY, QBO_ENV } = process.env;
if (!DATABASE_URL || !QBO_TOKEN_ENC_KEY) {
  console.error('Missing DATABASE_URL or QBO_TOKEN_ENC_KEY (source .env.local).');
  process.exit(1);
}

// Mirror src/lib/crypto/sealed-box.ts decrypt(): v1.<base64(iv[12]|tag[16]|ct)>.
function decrypt(payload) {
  const key = Buffer.from(QBO_TOKEN_ENC_KEY.trim(), 'base64');
  const dot = payload.indexOf('.');
  const b64 = payload.slice(dot + 1);
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
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
  console.error('Access token expired — reconnect on /admin/quickbooks, then re-run.');
  process.exit(1);
}

const realm = conn.realm_id;
const token = decrypt(conn.access_token_enc);
console.log(`realm=${realm} env=${QBO_ENV} apiBase=${apiBase}\n`);

async function get(path) {
  const res = await fetch(`${apiBase}/v3/company/${realm}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`GET ${path} → ${res.status}: ${await res.text()}`);
    return null;
  }
  return res.json();
}

const q = (sel) => `query?query=${encodeURIComponent(sel)}&minorversion=${MV}`;

// 1. Preferences → TaxPrefs (AST / using-sales-tax indicator)
const prefs = await get(`preferences?minorversion=${MV}`);
console.log('=== Preferences.TaxPrefs ===');
console.log(JSON.stringify(prefs?.Preferences?.TaxPrefs ?? 'none', null, 2));

// 2. TaxCodes
const tc = await get(q('SELECT * FROM TaxCode'));
const codes = tc?.QueryResponse?.TaxCode ?? [];
console.log(`\n=== TaxCode (${codes.length}) ===`);
for (const c of codes) {
  const sales = c.SalesTaxRateList?.TaxRateDetail?.map(
    (d) => `${d.TaxRateRef?.name ?? d.TaxRateRef?.value}${d.TaxTypeApplicable ? `[${d.TaxTypeApplicable}]` : ''}`,
  );
  console.log(
    `  #${c.Id} "${c.Name}" taxable=${c.Taxable} group=${c.TaxGroup} active=${c.Active}` +
      (sales?.length ? ` salesRates=[${sales.join(', ')}]` : ''),
  );
}

// 3. TaxRates
const tr = await get(q('SELECT * FROM TaxRate'));
const rates = tr?.QueryResponse?.TaxRate ?? [];
console.log(`\n=== TaxRate (${rates.length}) ===`);
for (const r of rates) {
  console.log(`  #${r.Id} "${r.Name}" rate=${r.RateValue}% active=${r.Active} agency=${r.AgencyRef?.value ?? '-'}`);
}
