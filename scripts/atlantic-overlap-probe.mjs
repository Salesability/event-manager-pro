// READ-ONLY probe (chunk 0086, Phase 1 → run at the Phase-6 prod gate): for the
// cleaned Atlantic BD list, count how many rooftops ALREADY exist as (1) app
// dealers (name+address, the import's dedup key) and (2) QBO Customers
// (DisplayName) in the connected company. No DB writes, no QBO writes —
// SELECT/GET only. Informs the prod-overlap handling decision (decision.md D7)
// BEFORE the bulk import writes anything to prod.
//
// Usage (prod):
//   QBO_ENV=production ./scripts/with-prod-db.sh node scripts/atlantic-overlap-probe.mjs
//   (with-prod-db.sh injects the prod DATABASE_URL + loads QBO_TOKEN_ENC_KEY from
//    .env.prod.local; QBO_ENV=production selects the prod QBO API base.)
// Usage (sandbox): set -a && source .env.local && set +a && node scripts/atlantic-overlap-probe.mjs

import { createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const { DATABASE_URL, QBO_TOKEN_ENC_KEY, QBO_ENV } = process.env;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL (run via ./scripts/with-prod-db.sh or source .env.local).');
  process.exit(1);
}
const haveEncKey = !!QBO_TOKEN_ENC_KEY?.trim();

function decrypt(payload) {
  const key = Buffer.from(QBO_TOKEN_ENC_KEY.trim(), 'base64');
  const buf = Buffer.from(payload.slice(payload.indexOf('.') + 1), 'base64');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

const norm = (s) => (s ?? '').trim().toLowerCase();

// ---- load the committed import list; apply drop-list + name+city dedup ----
const doc = JSON.parse(
  readFileSync(new URL('./data/atlantic-dealers.json', import.meta.url), 'utf8'),
);
const dropKeys = new Set(doc.dropList.map((d) => `${norm(d.name)}|${norm(d.city)}`));
const importDealers = [];
const seen = new Set();
for (const r of doc.rows) {
  const key = `${norm(r.dealership)}|${norm(r.city)}`;
  if (dropKeys.has(key) || seen.has(key)) continue; // skip-flagged + 2nd Motor Hub
  seen.add(key);
  importDealers.push({ name: r.dealership, city: r.city, key, nameKey: norm(r.dealership) });
}
console.log(`\n=== Import list (after drop-list + name+city dedup) ===`);
console.log(`rows in file=${doc.rows.length}  dropList=${doc.dropList.length}  → distinct import dealers=${importDealers.length}`);

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

// (1) app overlap — name+address (city-only) is the dedup key; name-only is the
// looser check that surfaces dupes a city-only address would miss (decision.md D6).
const appDealers = await sql`
  select name, address from dealers where archived_at is null`;
const appByNameAddr = new Set(appDealers.map((d) => `${norm(d.name)}|${norm(d.address)}`));
const appByName = new Set(appDealers.map((d) => norm(d.name)));

let appNameAddr = 0;
let appNameOnly = 0;
const nameOnlyHits = [];
for (const d of importDealers) {
  if (appByNameAddr.has(d.key)) appNameAddr++;
  else if (appByName.has(d.nameKey)) {
    appNameOnly++;
    nameOnlyHits.push(d.name);
  }
}
console.log(`\n=== (1) Existing prod APP dealers ===`);
console.log(`prod dealers (non-archived)=${appDealers.length}`);
console.log(`import rooftops already present by name+address (city) → SKIP-existing: ${appNameAddr}`);
console.log(`import rooftops matching an existing name but NOT name+address (would INSERT a near-dup): ${appNameOnly}`);
if (nameOnlyHits.length) console.log(`  name-only hits: ${nameOnlyHits.slice(0, 20).join(' | ')}${nameOnlyHits.length > 20 ? ' …' : ''}`);

const [conn] = await sql`
  select realm_id, access_token_enc, access_token_expires_at
  from quickbooks_connection limit 1`;
await sql.end();

// (2) QBO overlap — DisplayName match.
console.log(`\n=== (2) Existing prod QBO Customers (DisplayName) ===`);
if (!conn) {
  console.log(`NO quickbooks_connection row → QBO overlap not checked (treat as 0 until connected).`);
  process.exit(0);
}
if (new Date(conn.access_token_expires_at) <= new Date()) {
  console.log(`QBO access token EXPIRED (${conn.access_token_expires_at}) → reconnect on /admin/quickbooks, then re-run. QBO overlap not checked.`);
  process.exit(0);
}
if (!haveEncKey) {
  console.log(`QBO_TOKEN_ENC_KEY not provided → QBO overlap not checked. Put it in .env.prod.local and re-run.`);
  process.exit(0);
}

const apiBase =
  QBO_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
const MV = '75';
const realm = conn.realm_id;
const token = decrypt(conn.access_token_enc);

async function qboGet(path) {
  const res = await fetch(`${apiBase}/v3/company/${realm}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`QBO GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

let start = 1;
const customers = [];
for (let page = 0; page < 30; page++) {
  const json = await qboGet(
    `query?query=${encodeURIComponent(`SELECT Id, DisplayName FROM Customer WHERE Active = true STARTPOSITION ${start} MAXRESULTS 100`)}&minorversion=${MV}`,
  );
  const batch = json?.QueryResponse?.Customer ?? [];
  customers.push(...batch);
  if (batch.length < 100) break;
  start += 100;
}
const qboNames = new Set(customers.map((c) => norm(c.DisplayName)));
let qboMatch = 0;
const qboHits = [];
for (const d of importDealers) {
  if (qboNames.has(d.nameKey)) {
    qboMatch++;
    qboHits.push(d.name);
  }
}
console.log(`realm=${realm} env=${QBO_ENV ?? 'sandbox'}  active QBO Customers=${customers.length}`);
console.log(`import rooftops matching a QBO Customer DisplayName → leave-unlinked (prospect doesn't push): ${qboMatch}`);
if (qboHits.length) console.log(`  QBO DisplayName hits: ${qboHits.slice(0, 20).join(' | ')}${qboHits.length > 20 ? ' …' : ''}`);

console.log(`\n=== SUMMARY ===`);
console.log(`import dealers=${importDealers.length}  app(name+addr)=${appNameAddr}  app(name-only)=${appNameOnly}  qbo(DisplayName)=${qboMatch}`);
console.log(`Default handling (decision.md D7): app name+addr → skip; qbo-only → leave unlinked. Confirm before the prod import.`);
