// Manual per-province tax-code override (0075 decision 3, done as a script until
// the override UI exists). Maps each listed province's `tax_rates` row to an
// EXPLICIT QBO TaxCode by exact name — bypassing 0075's name heuristic, which
// can't disambiguate duplicate/oddly-named codes (e.g. prod has both "HST NS"
// 15% [old] and "HST NS 2025" 14% [current]; the heuristic picks the stale 15%).
//
// Self-validating: it resolves each mapped code NAME → its live Id + summed sales
// rate from the connected QBO company, so a code Id can't drift. Dry-run by
// default (prints the plan, writes nothing); pass --apply to write.
//
// READ of QBO is GET-only (no QBO writes, no token refresh). The only mutation is
// an idempotent UPDATE of `tax_rates.{quickbooks_tax_code_id, rate}` for the
// mapped provinces, inside one transaction.
//
// Usage (prod):
//   QBO_TOKEN_ENC_KEY="$(gcloud secrets versions access latest --secret=quickbooks-token-enc-key --project=eventpro-498313)" \
//   QBO_ENV=production \
//   ./scripts/with-prod-db.sh node scripts/0075-tax-map.mjs            # dry-run
//   ... same env ...  ./scripts/with-prod-db.sh node scripts/0075-tax-map.mjs --apply   # write

import { createDecipheriv } from 'node:crypto';
import postgres from 'postgres';

// --- EDIT THIS: province → exact QBO TaxCode Name -----------------------------
// Only provinces listed here are touched. Everything else keeps its current
// state (app-managed / unmanaged). Names must match the QBO TaxCode.Name exactly
// (case-insensitive). Provinces not listed are NOT cleared or changed.
const PROVINCE_CODE_NAME = {
  ON: 'HST ON', // → 13%
  NS: 'HST NS 2025', // → 14% (the CURRENT NS rate; NOT the stale "HST NS" 15%)
  NB: 'HST Atlantic 15%', // → 15% (shared Atlantic HST code)
  NL: 'HST Atlantic 15%', // → 15%
  PE: 'HST Atlantic 15%', // → 15%
  // BC/SK/MB/QC: no combined GST+PST/QST code in this QBO company → left app-managed.
  // AB/NT/NU/YT: "GST 5%" has no resolvable sales rate here → left app-managed.
};
// -----------------------------------------------------------------------------

const APPLY = process.argv.includes('--apply');
const { DATABASE_URL, QBO_TOKEN_ENC_KEY, QBO_ENV } = process.env;
if (!DATABASE_URL || !QBO_TOKEN_ENC_KEY) {
  console.error('Missing DATABASE_URL or QBO_TOKEN_ENC_KEY.');
  process.exit(1);
}

// Mirror src/lib/crypto/sealed-box.ts decrypt(): v1.<base64(iv[12]|tag[16]|ct)>.
function decrypt(payload) {
  const key = Buffer.from(QBO_TOKEN_ENC_KEY.trim(), 'base64');
  const b64 = payload.slice(payload.indexOf('.') + 1);
  const buf = Buffer.from(b64, 'base64');
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
if (!conn) {
  console.error('No quickbooks_connection row.');
  await sql.end();
  process.exit(1);
}
if (new Date(conn.access_token_expires_at) <= new Date()) {
  console.error('QBO access token expired — reconnect on /admin/quickbooks, then re-run.');
  await sql.end();
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
const q = (sel) => `query?query=${encodeURIComponent(sel)}&minorversion=${MV}`;

// Live QBO codes + rates → resolve each mapped name to { id, ratePct }.
const codes = (await qboGet(q('SELECT * FROM TaxCode')))?.QueryResponse?.TaxCode ?? [];
const rates = (await qboGet(q('SELECT * FROM TaxRate')))?.QueryResponse?.TaxRate ?? [];
const rateById = new Map(rates.filter((r) => r.RateValue != null).map((r) => [r.Id, r.RateValue]));

// Sum a code's SalesTaxRateList rates (mirrors tax-sync.ts resolveCodeRatePct).
function codeRatePct(code) {
  const details = code.SalesTaxRateList?.TaxRateDetail ?? [];
  if (!details.length) return null;
  let sum = 0;
  for (const d of details) {
    const rv = d.TaxRateRef?.value != null ? rateById.get(d.TaxRateRef.value) : undefined;
    if (rv == null) return null;
    sum += rv;
  }
  return sum;
}

const targets = []; // { province, codeId, codeName, ratePct }
let resolveError = false;
for (const [province, name] of Object.entries(PROVINCE_CODE_NAME)) {
  const matches = codes.filter(
    (c) => c.Active !== false && (c.Name ?? '').toLowerCase() === name.toLowerCase(),
  );
  if (matches.length !== 1) {
    console.error(`✗ ${province}: expected exactly 1 active code named "${name}", found ${matches.length}.`);
    resolveError = true;
    continue;
  }
  const ratePct = codeRatePct(matches[0]);
  if (ratePct == null) {
    console.error(`✗ ${province}: code "${name}" (#${matches[0].Id}) has no resolvable sales rate.`);
    resolveError = true;
    continue;
  }
  targets.push({ province, codeId: matches[0].Id, codeName: name, ratePct });
}
if (resolveError) {
  console.error('\nResolve errors above — fix PROVINCE_CODE_NAME and re-run. No DB changes made.');
  await sql.end();
  process.exit(1);
}

// Current prod state for the mapped provinces.
const provinces = targets.map((t) => t.province);
const current = await sql`
  select province, rate, quickbooks_tax_code_id
  from tax_rates where province in ${sql(provinces)}`;
const curByProv = new Map(current.map((r) => [r.province, r]));

console.log(`realm=${realm} env=${QBO_ENV} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
console.log('province | current (code, rate) → new (code, rate)   [change?]');
const writes = [];
for (const t of targets) {
  const cur = curByProv.get(t.province);
  const newRate = t.ratePct.toFixed(3);
  if (!cur) {
    console.log(`  ${t.province}: NO tax_rates row — skipped.`);
    continue;
  }
  const changed = cur.quickbooks_tax_code_id !== t.codeId || cur.rate !== newRate;
  console.log(
    `  ${t.province}: (${cur.quickbooks_tax_code_id ?? '—'}, ${cur.rate}) → ` +
      `(#${t.codeId} "${t.codeName}", ${newRate})   [${changed ? 'CHANGE' : 'no-op'}]`,
  );
  if (changed) writes.push({ province: t.province, codeId: t.codeId, rate: newRate });
}

if (!APPLY) {
  console.log(`\nDRY-RUN — no changes written. ${writes.length} province(s) would change. Re-run with --apply to write.`);
  await sql.end();
  process.exit(0);
}

if (!writes.length) {
  console.log('\nNothing to write (all mapped provinces already in the desired state).');
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  for (const w of writes) {
    await tx`
      update tax_rates set quickbooks_tax_code_id = ${w.codeId}, rate = ${w.rate}
      where province = ${w.province}`;
  }
});
console.log(`\n✅ Applied ${writes.length} province mapping(s): ${writes.map((w) => w.province).join(', ')}.`);
await sql.end();
