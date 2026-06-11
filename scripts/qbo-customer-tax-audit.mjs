// READ-ONLY audit (0076 follow-up): every QBO customer whose DefaultTaxCodeRef
// mismatches its province — wrong rate, a code named for a DIFFERENT province, a
// non-sales/missing code, or no province on the customer. GET/query only — no
// writes, no token refresh. The "expected" rate per province comes from the app's
// own `tax_rates` table (the source of truth), read over the same DB connection.
//
// Usage (prod):
//   QBO_TOKEN_ENC_KEY="$(gcloud secrets versions access latest --secret=quickbooks-token-enc-key --project=eventpro-498313)" \
//   QBO_ENV=production ./scripts/with-prod-db.sh node scripts/qbo-customer-tax-audit.mjs

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
const appRates = await sql`select province, rate from tax_rates`;
await sql.end();

if (!conn) {
  console.error('No quickbooks_connection row.');
  process.exit(1);
}
if (new Date(conn.access_token_expires_at) <= new Date()) {
  console.error('QBO access token expired — reload /admin/quickbooks on prod to refresh, then re-run.');
  process.exit(1);
}

const realm = conn.realm_id;
const token = decrypt(conn.access_token_enc);
const expectedByProv = new Map(appRates.map((r) => [r.province, Number(r.rate)]));

const CODES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const NAME_TO_CODE = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  'newfoundland and labrador': 'NL', newfoundland: 'NL', 'nova scotia': 'NS',
  'northwest territories': 'NT', nunavut: 'NU', ontario: 'ON',
  'prince edward island': 'PE', quebec: 'QC', québec: 'QC', saskatchewan: 'SK', yukon: 'YT',
};
function normProv(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (CODES.includes(t.toUpperCase())) return t.toUpperCase();
  return NAME_TO_CODE[t.toLowerCase()] ?? null;
}

async function qboGet(path) {
  const res = await fetch(`${apiBase}/v3/company/${realm}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`QBO GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
const q = (sel) => `query?query=${encodeURIComponent(sel)}&minorversion=${MV}`;

const codes = (await qboGet(q('SELECT * FROM TaxCode')))?.QueryResponse?.TaxCode ?? [];
const taxrates = (await qboGet(q('SELECT * FROM TaxRate')))?.QueryResponse?.TaxRate ?? [];
const rateById = new Map(taxrates.filter((r) => r.RateValue != null).map((r) => [r.Id, r.RateValue]));
const codeById = new Map(codes.map((c) => [c.Id, c]));
function codeRate(code) {
  const d = code?.SalesTaxRateList?.TaxRateDetail ?? [];
  if (!d.length) return null;
  let s = 0;
  for (const x of d) {
    const rv = x.TaxRateRef?.value != null ? rateById.get(x.TaxRateRef.value) : undefined;
    if (rv == null) return null;
    s += rv;
  }
  return s;
}

// Paginate ALL customers.
const customers = [];
let start = 1;
const page = 100;
for (;;) {
  const j = await qboGet(q(`SELECT * FROM Customer STARTPOSITION ${start} MAXRESULTS ${page}`));
  const batch = j?.QueryResponse?.Customer ?? [];
  customers.push(...batch);
  if (batch.length < page) break;
  start += page;
}

const mismatches = [];
let withDefault = 0;
for (const c of customers) {
  const codeId = c.DefaultTaxCodeRef?.value;
  if (codeId == null) continue;
  withDefault++;
  const code = codeById.get(codeId);
  const cname = code?.Name ?? `#${codeId}`;
  const crate = code ? codeRate(code) : null;
  const prov = normProv(c.BillAddr?.CountrySubDivisionCode);
  const expected = prov != null ? expectedByProv.get(prov) : undefined;

  const issues = [];
  if (!code) issues.push('default code not found among active codes (inactive/deleted)');
  else if (crate == null) issues.push(`code "${cname}" has no resolvable sales rate`);
  if (prov == null) issues.push(`no/unknown province (BillAddr=${c.BillAddr?.CountrySubDivisionCode ?? '—'})`);
  if (crate != null && expected != null && Math.abs(crate - expected) > 0.001)
    issues.push(`rate ${crate}% ≠ province ${expected}%`);
  if (prov) {
    for (const other of CODES) {
      if (other === prov) continue;
      if (new RegExp(`\\b${other}\\b`).test(cname)) {
        issues.push(`code names ${other}, not ${prov}`);
        break;
      }
    }
  }
  if (issues.length) {
    mismatches.push({ id: c.Id, name: c.DisplayName ?? c.CompanyName ?? '?', prov: prov ?? '—', code: cname, crate, expected, issues });
  }
}

console.log(`realm=${realm} env=${QBO_ENV}`);
console.log(`Customers: ${customers.length} total · ${withDefault} have a default tax code · ${mismatches.length} mismatched\n`);
console.log('=== MISMATCHES (default tax code ≠ province) ===');
if (!mismatches.length) console.log('  none 🎉');
for (const m of mismatches) {
  const rate = m.crate == null ? 'n/a' : `${m.crate}%`;
  const exp = m.expected == null ? '?' : `${m.expected}%`;
  console.log(`  #${m.id} "${m.name}" | province=${m.prov} (expects ${exp}) | default="${m.code}" (${rate})`);
  for (const i of m.issues) console.log(`        ⚠ ${i}`);
}
